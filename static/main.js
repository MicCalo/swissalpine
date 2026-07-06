import { initMap } from '/static/map-view.js';
import { buildPlot, getPlot, getXScale, getYScale } from '/static/chart-view.js';
import { getGradeAjustment, predict  } from '/static/model.js';
import { initializeSegments, initializeCheckPoints } from '/static/init-utils.js';
import { Checkpoint } from '/static/checkpoint.js';
import { toHHMM  } from '/static/utils.js';

const COLOR = '#cc0000';
const { points: trackPoints, segments: trackSegments, gapPolys, targetParams, forecastParams, actualPoints, startTime } = window.RAW

const startTimeMinutes = startTime.getHours() * 60 + startTime.getMinutes()

// Derive cumDist, ele, gradAdj ect. on each segment
initializeSegments(trackSegments, trackPoints, gapPolys);
const checkPoints = initializeCheckPoints(trackSegments, trackPoints);

predict(trackSegments, checkPoints, targetParams);

// Forecast starts out identical to plan; refitForecast() (below) adjusts
// it as real checkpoint crossings come in.
Object.assign(forecastParams, targetParams, { name: 'forecast' });
predict(trackSegments, checkPoints, forecastParams);


// Map
const { map, highlight, actualPosition, actualRoutePoly, isAutoPanActualPositionEnabled, isAutoPanChartPositionEnabled } = initMap(trackPoints, checkPoints, actualPoints, COLOR);

// Chart
let autoPan = true;
let doneIdx = -1; // last completed segment index, driven by actual position pings
let panTimer = null;
const PAN_DEBOUNCE_MS = 400;

// Nearest track point to a lat/lon, used both to drive the map crosshair
// from mouse hover and to figure out how far along the route we are.
function nearestTrackPoint(lat, lon, maxMeters = 300) {
    let best = null, bestDist = Infinity;
    for (const p of trackPoints) {
        const m = map.distance([lat, lon], [p.lat, p.lon]);
        if (m < bestDist) { bestDist = m; best = p; }
    }
    return (best && bestDist < maxMeters) ? best : null;
}

// Chart → Map
function onPlotInput() {
    const d = getPlot().value;
    clearTimeout(panTimer);
    if (d) {
        const centerIdx = Math.trunc((d.start_idx + d.end_idx) / 2);
        const pt = trackPoints[centerIdx];
        highlight.setLatLng([pt.lat, pt.lon]).addTo(map);

        // Debounce: only pan once the hover has settled on a spot for a bit,
        // so a quick pass-through over the chart doesn't yank the map around.
        if (autoPan && isAutoPanChartPositionEnabled()) {
            panTimer = setTimeout(() => {
                if (!map.getBounds().contains([pt.lat, pt.lon])) {
                    map.panTo([pt.lat, pt.lon], { animate: true, duration: 2.0 });
                }
            }, PAN_DEBOUNCE_MS);
        }
    } else {
        highlight.remove();
    }
}

// Map → Chart: drive crosshair via synthetic pointer events
map.on('mousemove', e => {
    const plot   = getPlot();
    const xScale = getXScale();
    const yScale = getYScale();
    const rect   = plot.getBoundingClientRect();

    const best = nearestTrackPoint(e.latlng.lat, e.latlng.lng);

    // Default to x=0 (outside plot frame) → clears crosshair
    let x = rect.left;
    let y = rect.top + rect.height / 2;
    if (best) {
        const seg = trackSegments[best.seg_idx];
        x = rect.left + xScale.apply(seg.cumDist);
        y = rect.top  + yScale.apply(seg.ele);
    }

    autoPan = false;
    plot.dispatchEvent(new PointerEvent('pointermove', {
        clientX: x, clientY: y, bubbles: true, pointerId: 1, isPrimary: true,
    }));
    autoPan = true;
});

function rebuildPlot() {
    buildPlot(trackSegments, checkPoints, COLOR, onPlotInput, doneIdx);
}

// --- Live GPS → route-progress trace, driving both the "done" chart fill
// and interpolated checkpoint crossing times (cp.actualDuration) ---
let lastMatchIdx = 0;    // windowed-search anchor, see nearestPointWindowed
let maxCumLkm = 0;       // monotonic clamp, absorbs backward GPS jitter
let nextCpIdx = 1;       // checkpoint 0 (Start) is defined as t=0 below, not GPS-interpolated
const progressTrace = []; // [{ts, cumLkm}], real GPS-derived points only — no synthetic anchor

// Elapsed-time reference, in epoch seconds. Mutable: see checkStartTimeSanity —
// if this is way off (e.g. wrong date/timezone during dev testing), it gets
// back-calculated from the 2nd checkpoint crossing instead of trusted blindly.
let effectiveStartTs = startTime.getTime() / 1000;
let startTimeSanityChecked = false;
const STARTTIME_SANITY_THRESHOLD_MIN = 120; // far beyond plausible pace variance over ~0.5 lkm

checkPoints[0].actualTs = effectiveStartTs;
checkPoints[0].actualDuration = 0;

// Windowed nearest-point search for sequential GPS pings: only look near
// the last accepted match (100 pts back / 1000 forward) instead of the
// whole route, so a switchback — or start/finish proximity on a loop
// course — can't snap the match to the wrong part of the route.
function nearestPointWindowed(lat, lon, maxMeters = 300) {
    const lo = Math.max(0, lastMatchIdx - 100);
    const hi = Math.min(trackPoints.length - 1, lastMatchIdx + 1000);
    let best = null, bestDist = Infinity, bestIdx = -1;
    for (let i = lo; i <= hi; i++) {
        const p = trackPoints[i];
        const m = map.distance([lat, lon], [p.lat, p.lon]);
        if (m < bestDist) { bestDist = m; best = p; bestIdx = i; }
    }
    if (best && bestDist < maxMeters) {
        lastMatchIdx = bestIdx;
        return best;
    }
    return null;
}

// If the 2nd checkpoint's elapsed time is wildly off from plan, the most
// likely explanation this early in the race is a wrong start-time
// reference (wrong date/timezone, dev config left over from testing),
// not the runner's actual pace already being that far off. Back-calculate
// a corrected reference from this checkpoint's raw timestamp + its target
// duration, and refresh checkpoint 0 (which is defined relative to it,
// not independently observed) to match.
function checkStartTimeSanity(cp) {
    if (startTimeSanityChecked) return;
    startTimeSanityChecked = true;
    if (cp.targetDuration == null) return; // nothing to compare against

    const diff = cp.actualDuration - cp.targetDuration;
    if (Math.abs(diff) <= STARTTIME_SANITY_THRESHOLD_MIN) return; // plausible pace variance — leave it

    console.warn(`Start time looks ~${(diff / 60).toFixed(1)}h off ` +
        `(2nd checkpoint actual ${cp.actualDuration.toFixed(1)} min vs target ${cp.targetDuration.toFixed(1)} min). ` +
        `Back-calculating a corrected start time.`);

    effectiveStartTs = cp.actualTs - cp.targetDuration * 60;
    checkPoints[0].actualTs = effectiveStartTs;
    checkPoints[0].actualDuration = 0;
    cp.actualDuration = (cp.actualTs - effectiveStartTs) / 60; // ≈ cp.targetDuration, by construction
}

// --- Forecast fitting: a three-phase re-fit of forecastParams driven by
// checkpoint crossings so far.
//   Phase 1 (< 30 lkm): too little data to trust anything but a flat
//     offset — "if I'm 5 min behind, assume everything ahead shifts by 5 min."
//   Phase 2 (30–60 lkm): a single global baseSpeed scalar is identifiable
//     and sufficient; fit it in closed form (duration ∝ 1/baseSpeed).
//   Phase 3 (≥ 60 lkm): comfortably past the fatigue onset (40 lkm), so
//     there's finally a real curve to fit onset/lambda against. Not
//     implemented yet — left as a deliberate no-op below.
const PHASE1_END_LKM = 30;
const PHASE2_END_LKM = 60; // picked so onset=40lkm sits inside this range, not at its edge
const OFFSET_WINDOW = 5;   // rolling window (in checkpoints) for the phase-1 offset

function refitForecast() {
    const lastIdx = nextCpIdx - 1; // most recently crossed checkpoint
    if (lastIdx < 1) return;       // nothing but the start line crossed yet
    const currentLkm = checkPoints[lastIdx].cumLkm;

    if (currentLkm < PHASE1_END_LKM) {
        // Flat offset from a short rolling window of recent checkpoints,
        // so one noisy crossing (aid station queue, a bad GPS ping)
        // doesn't whipsaw the whole remaining forecast.
        const from = Math.max(1, lastIdx - OFFSET_WINDOW + 1);
        let sumDiff = 0, n = 0;
        for (let i = from; i <= lastIdx; i++) {
            sumDiff += checkPoints[i].actualDuration - checkPoints[i].targetDuration;
            n++;
        }
        const offset = sumDiff / n;
        for (const cp of checkPoints) cp.forecastDuration = cp.targetDuration + offset;

    } else if (currentLkm < PHASE2_END_LKM) {
        // Closed-form baseSpeed scaling: duration is inversely proportional
        // to baseSpeed, so the ratio of summed actual-vs-target *interval*
        // durations directly gives the multiplier — no optimizer needed.
        let sumActual = 0, sumTarget = 0;
        for (let i = 1; i <= lastIdx; i++) {
            sumActual += checkPoints[i].actualDuration - checkPoints[i - 1].actualDuration;
            sumTarget += checkPoints[i].targetDuration - checkPoints[i - 1].targetDuration;
        }
        const k = sumTarget > 0 ? sumActual / sumTarget : 1;
        Object.assign(forecastParams, targetParams, { name: 'forecast', baseSpeed: targetParams.baseSpeed / k });
        predict(trackSegments, checkPoints, forecastParams);

    } else {
        // Phase 3 (onset/lambda refit) isn't implemented yet — deliberately
        // left as a no-op rather than silently reverting to target or
        // extrapolating phase 2's baseSpeed indefinitely.
    }
}

// Fill in actualDuration for every checkpoint whose cumLkm falls between
// the previous and new trace point, via linear interpolation of ts. A
// while-loop (not if) so a coarse ping interval spanning multiple
// checkpoints backfills all of them from the same bracketing pair.
function interpolateCheckpointCrossings(prevPoint, newPoint) {
    const before = nextCpIdx;
    while (nextCpIdx < checkPoints.length && checkPoints[nextCpIdx].cumLkm <= newPoint.cumLkm) {
        const idx = nextCpIdx;
        const cp = checkPoints[idx];
        const span = newPoint.cumLkm - prevPoint.cumLkm;
        const frac = span > 0 ? (cp.cumLkm - prevPoint.cumLkm) / span : 0;
        cp.actualTs = prevPoint.ts + frac * (newPoint.ts - prevPoint.ts); // purely real-GPS-derived
        cp.actualDuration = (cp.actualTs - effectiveStartTs) / 60; // minutes
        nextCpIdx++;

        if (cp.hidden){
            console.debug("Crossed checkpoint at lkm " + cp.cumLkm.toFixed(2) + " (hidden)");
        }
        else{
            console.info("Crossed checkpoint '" + cp.name + "' at lkm " + cp.cumLkm.toFixed(2) + " (visible)");
        }

        if (idx === 1) checkStartTimeSanity(cp);
    }
    if (nextCpIdx > before) refitForecast();
}

// Feed one GPS fix (historical replay or a live ping) through the
// pipeline. Returns the matched track point, or null if it fell outside
// the window/radius (that ping is simply skipped, not treated as an error).
function recordProgress(ts, lat, lon) {
    const nearest = nearestPointWindowed(lat, lon);
    if (!nearest) return null;
    maxCumLkm = Math.max(maxCumLkm, trackSegments[nearest.seg_idx].cumLkm);
    const point = { ts, cumLkm: maxCumLkm };
    const prev = progressTrace[progressTrace.length - 1]; // undefined on the very first real ping
    progressTrace.push(point);
    if (prev) interpolateCheckpointCrossings(prev, point);
    return nearest;
}

// Backfill from any positions already logged before this page loaded
// (e.g. after a refresh mid-race), so actualDuration and doneIdx reflect
// reality immediately rather than only from the next live ping onward.
for (const p of actualPoints) {
    const nearest = recordProgress(p.ts, p.lat, p.lon);
    if (nearest && nearest.seg_idx > doneIdx) doneIdx = nearest.seg_idx;
}

rebuildPlot();

// Table
const tbody = document.getElementById('tbody');
for (const cp of checkPoints) {
    if (cp.hidden) { continue; }
    
    const tr = document.createElement('tr');
    let next = cp.dist ? `${cp.dist.toFixed(1)} ${cp.ascent.toFixed(0)} ${cp.descent.toFixed(0)}` : '—';
    tr.innerHTML = `
        <td>${cp.name}</td>
        <td>${toHHMM(cp.targetDuration + startTimeMinutes)}</td>     <!-- target -->
        <td>${toHHMM(cp.actualDuration + startTimeMinutes)}</td>     <!-- actual -->
        <td>—</td>     <!-- delta -->
        <td>—</td>     <!-- delta -->
        <td>${cp.cumDist.toFixed(0)}</td>
        <td>${cp.cumAscent.toFixed(0)}</td>     <!-- up -->
        <td>${cp.cumDescent.toFixed(0)}</td>     <!-- down -->
        <td>${cp.dist ? cp.dist.toFixed(1) : '-'}</td>     <!-- next -> -->
        <td>${cp.ascent ? cp.ascent.toFixed(0) : '-'}</td>     <!-- next up-->
        <td>${cp.descent ? cp.descent.toFixed(0) : '-'}</td>     <!-- next down -->
        <td>${cp.cumLkm.toFixed(0)}</td>     <!-- lkm -->
    `;
    tbody.appendChild(tr);
}

const evtSource = new EventSource("/position");

evtSource.addEventListener("posUpdate", (event) => {
    const data = JSON.parse(event.data)
    // update marker
    actualPosition.setLatLng([data.lat, data.lon]).addTo(map);

    if (isAutoPanActualPositionEnabled()) {
        map.panTo([data.lat, data.lon], { animate: true });
    }

    // add to list
    actualPoints.push(data);
    actualRoutePoly.addLatLng([data.lat, data.lon]);

    // advance the "done" portion of the elevation profile — only rebuild
    // when it actually changes, so the plot (and any active hover/crosshair
    // state on it) isn't torn down and recreated on every single ping.
    // This also feeds the route-progress trace used to interpolate
    // checkpoint crossing times (see recordProgress above).
    const nearest = recordProgress(data.ts, data.lat, data.lon);
    if (nearest && nearest.seg_idx > doneIdx) {
        doneIdx = nearest.seg_idx;
        rebuildPlot();
    }
});

// Layout — resizable split panels
Split(['#map', '#table-wrapper'], {
    sizes: [65, 35], gutterSize: 6,
    onDrag:    () => map.invalidateSize(),
    onDragEnd: () => rebuildPlot(),
});
Split(['#top', '#profile'], {
    direction: 'vertical', sizes: [80, 20], gutterSize: 6,
    onDragEnd: () => { map.invalidateSize(); rebuildPlot(); },
});
