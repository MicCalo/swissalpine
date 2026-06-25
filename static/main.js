import { initMap } from '/static/map-view.js';
import { buildPlot, getPlot, getXScale, getYScale } from '/static/chart-view.js';

const COLOR = '#cc0000';
const { points: trackPoints, segments: trackSegments } = window.RAW;

// Derive cumDist and ele on each segment
let cumDist = 0;
let gapCumDist = 0;
for (const seg of trackSegments) {
    cumDist     += seg.dist / 1000;
    seg.ele      = trackPoints[seg.end_idx].ele;
    seg.cumDist  = cumDist;

}

// Checkpoint list: named track points enriched with cumDist
const checkPoints = trackPoints
    .filter(p => p.name)
    .map(p => ({
        name:    p.name,
        ele:     p.ele,
        lat:     p.lat,
        lon:     p.lon,
        cumDist: trackSegments[p.seg_idx].cumDist,
    }));

// Map
const { map, highlight } = initMap(trackPoints, checkPoints, COLOR);

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
    tr.innerHTML = `
        <td>${cp.name}</td>
        <td>${cp.cumDist.toFixed(0)}</td>
    `;
    tbody.appendChild(tr);
}

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
