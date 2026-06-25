let _plot, _xScale, _yScale;

export function buildPlot(trackSegments, checkPoints, color, onInput) {
    const div = document.querySelector('#profile');
    if (_plot) _plot.remove();

    _plot = Plot.plot({
        width:  div.clientWidth,
        height: div.clientHeight,
        marks: [
            Plot.dot(checkPoints, { x: 'cumDist', y: 'ele', fill: color, r: 4 }),
            Plot.text(checkPoints, { x: 'cumDist', y: 'ele', text: 'name', dy: -20, fontSize: 10, textAnchor: 'middle' }),
            Plot.areaY(trackSegments, { x: 'cumDist', y: 'ele', y2: d3.min(trackSegments, d => d.ele), fill: '#8884' }),
            Plot.lineY(trackSegments, { x: 'cumDist', y: 'ele', stroke: color }),
            Plot.crosshairX(trackSegments, { x: 'cumDist', y: 'ele' }),
            Plot.tip(trackSegments, Plot.pointerX({ x: 'cumDist', y: 'ele', title: d => `${d.cumDist.toFixed(1)} km, ${d.ele.toFixed(0)} m` })),
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
