let _plot, _xScale, _yScale;

const DONE_COLOR = 'blue'; // matches actualRoutePoly on the map

// Convenience: derive a segment index from a cumDist (x) value, for callers
// that prefer to track progress by distance instead of index.
export function segIdxForCumDist(trackSegments, cumDist) {
    if (cumDist == null) return -1;
    const idx = trackSegments.findIndex(s => s.cumDist >= cumDist);
    return idx === -1 ? trackSegments.length - 1 : idx;
}

// doneIdx: index of the last completed segment in trackSegments (-1 = nothing done yet).
export function buildPlot(trackSegments, checkPoints, color, onInput, doneIdx = -1) {
    const div = document.querySelector('#profile');
    if (_plot) _plot.remove();

    const clampedIdx = Math.max(-1, Math.min(doneIdx, trackSegments.length - 1));
    const doneSegments      = trackSegments.slice(0, clampedIdx + 1);
    const remainingSegments = trackSegments.slice(Math.max(clampedIdx, 0)); // shares boundary point, no gap

    _plot = Plot.plot({
        width:  div.clientWidth,
        height: div.clientHeight,
        marks: [
            Plot.dot(checkPoints, { x: 'cumDist', y: 'ele', fill: color, r: 4 }),
            Plot.text(checkPoints, { x: 'cumDist', y: 'ele', text: 'name', dy: -20, fontSize: 10, textAnchor: 'middle' }),

            Plot.areaY(doneSegments, { x: 'cumDist', y: 'ele', y2: d3.min(trackSegments, d => d.ele), fill: '#abf9' }),
            Plot.areaY(remainingSegments, { x: 'cumDist', y: 'ele', y2: d3.min(trackSegments, d => d.ele), fill: '#8884' }),

            Plot.lineY(doneSegments, { x: 'cumDist', y: 'ele', stroke: DONE_COLOR }),
            Plot.lineY(remainingSegments, { x: 'cumDist', y: 'ele', stroke: color }),

            Plot.crosshairX(trackSegments, { x: 'cumDist', y: 'ele' }),
            Plot.tip(trackSegments, Plot.pointerX({ x: 'cumDist', y: 'ele', title: d => `${d.cumDist.toFixed(1)} km, ${d.ele.toFixed(0)} m` })),
        ]
    });

    div.append(_plot);
    _xScale = _plot.scale('x');
    _yScale = _plot.scale('y');
    _plot.addEventListener('input', onInput);
}

export const getPlot   = () => _plot;
export const getXScale = () => _xScale;
export const getYScale = () => _yScale;
