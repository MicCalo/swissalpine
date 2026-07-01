import { initMap } from '/static/map-view.js';
import { buildPlot, getPlot, getXScale, getYScale } from '/static/chart-view.js';
import { getGradeAjustment, predict  } from '/static/model.js';
import { toHHMM  } from '/static/utils.js';

const COLOR = '#cc0000';
const { points: trackPoints, segments: trackSegments, gapPolys, targetParams, actualPoints, startTime } = window.RAW

const startTimeMinutes = startTime.getHours() * 60 + startTime.getMinutes()


// Checkpoint list: named track points
const checkPoints = trackPoints
    .filter(p => p.name)
    .map(p => ({
        name:    p.name,
        ele:     p.ele,
        lat:     p.lat,
        lon:     p.lon,
        seg_idx: p.seg_idx
    }));

checkPoints.forEach((cp, i) => {
    trackSegments[cp.seg_idx].checkpt_idx = i;
});

// Derive cumDist, ele, gradAdj ect. on each segment
let cumLkm = 0;
let cumDist = 0;
let cumAscent = 0;
let cumDescent = 0;

let lastCp = null

for (const seg of trackSegments) {    
    seg.grad = seg.grad / 1000
    seg.ele      = trackPoints[seg.end_idx].ele;
    seg.totalAscent = 0
    seg.totalDescent = 0
    for (let i = seg.start_idx; i < seg.end_idx; i++) {
        const delta = trackPoints[i + 1].ele - trackPoints[i].ele;
        if (delta > 0) {
            seg.totalAscent += delta;
        } else {
            seg.totalDescent -= delta;
        }
    }
    seg.gradAdj = getGradeAjustment(seg.grad, gapPolys);    

    let segDistKm = seg.dist / 1000.0;
    let segLkm = seg.totalAscent/100 + segDistKm
    cumDist += segDistKm;
    cumLkm += segLkm;
    cumAscent += seg.totalAscent;
    cumDescent += seg.totalDescent;

    seg.cumDist = cumDist;
    if (seg.checkpt_idx != null)
    {
        let cp = checkPoints[seg.checkpt_idx];
        cp.cumDist = seg.checkpt_idx === 0 ? 0 : cumDist;
        cp.cumLkm = seg.checkpt_idx === 0 ? 0 : cumLkm;
        cp.cumAscent = seg.checkpt_idx === 0 ? 0 : cumAscent;
        cp.cumDescent = seg.checkpt_idx === 0 ? 0 : cumDescent;
        if (lastCp){
            lastCp.dist = cp.cumDist - lastCp.cumDist;
            lastCp.ascent = cp.cumAscent - lastCp.cumAscent;
            lastCp.descent = cp.cumDescent - lastCp.cumDescent;
        }
        lastCp = cp;
    }    
}

predict(trackSegments, checkPoints, targetParams);


// Map
const { map, highlight, actualPosition, actualRoutePoly } = initMap(trackPoints, checkPoints, actualPoints, COLOR);

// Chart
let autoPan = true;
let doneIdx = -1; // last completed segment index, driven by actual position pings
let panTimer = null;
const PAN_DEBOUNCE_MS = 400;
const autoPanEnabled = document.getElementById('autopan-toggle');

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
        if (autoPan && autoPanEnabled.checked) {
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

rebuildPlot();

// Table
const tbody = document.getElementById('tbody');
for (const cp of checkPoints) {
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
    console.info("posUpdate: "+data.lat+"/"+data.lon+", ele: "+data.ele);

    // update marker
    actualPosition.setLatLng([data.lat, data.lon]).addTo(map);

    // add to list
    actualPoints.push(data);
    actualRoutePoly.addLatLng([data.lat, data.lon]);

    // advance the "done" portion of the elevation profile — only rebuild
    // when it actually changes, so the plot (and any active hover/crosshair
    // state on it) isn't torn down and recreated on every single ping
    const nearest = nearestTrackPoint(data.lat, data.lon);
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
