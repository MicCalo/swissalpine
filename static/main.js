import { initMap } from '/static/map-view.js';
import { buildPlot, getPlot, getXScale, getYScale } from '/static/chart-view.js';
import { getGradeAjustment, predict  } from '/static/model.js';
import { toHHMM  } from '/static/utils.js';

const COLOR = '#cc0000';
const { points: trackPoints, segments: trackSegments, gapPolys, targetParams } = window.RAW

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
const { map, highlight, actualPosition } = initMap(trackPoints, checkPoints, COLOR);

// Chart
let autoPan = true;

function onPlotInput() {
    const d = getPlot().value;
    if (d) {
        const centerIdx = Math.trunc((d.start_idx + d.end_idx) / 2);
        const pt = trackPoints[centerIdx];
        highlight.setLatLng([pt.lat, pt.lon]).addTo(map);
        if (autoPan && !map.getBounds().contains([pt.lat, pt.lon])) {
            map.panTo([pt.lat, pt.lon], { animate: true, duration: 2.0 });
        }
    } else {
        highlight.remove();
    }
}

function rebuildPlot() {
    buildPlot(trackSegments, checkPoints, COLOR, onPlotInput);
}

rebuildPlot();

// Map → Chart: drive crosshair via synthetic pointer events
map.on('mousemove', e => {
    const plot   = getPlot();
    const xScale = getXScale();
    const yScale = getYScale();
    const rect   = plot.getBoundingClientRect();

    let best = null, bestDist = Infinity;
    for (const p of trackPoints) {
        const m = map.distance(e.latlng, [p.lat, p.lon]);
        if (m < bestDist) { bestDist = m; best = p; }
    }

    // Default to x=0 (outside plot frame) → clears crosshair
    let x = rect.left;
    let y = rect.top + rect.height / 2;
    if (best && bestDist < 300) {
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

// Table
const tbody = document.getElementById('tbody');
for (const cp of checkPoints) {
    const tr = document.createElement('tr');
    let next = cp.dist ? `${cp.dist.toFixed(1)} ${cp.ascent.toFixed(0)} ${cp.descent.toFixed(0)}` : '—';
    tr.innerHTML = `
        <td>${cp.name}</td>
        <td>${toHHMM(cp.targetDuration)}</td>     <!-- target -->
        <td>${toHHMM(cp.actualDuration)}</td>     <!-- actual -->
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
    actualPosition.setLatLng([data.lat, data.lon]).addTo(map);
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
