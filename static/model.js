function getFatigueMultiplier(params, cumulativeLkm)
{
    if (cumulativeLkm <= params.onset) return 1.0;
    return params.floor + (1.0 - params.floor) * Math.exp(-params.lambda * (cumulativeLkm - params.onset));
}

function poly(input, coeffs) {
    return coeffs.reduceRight((acc, c) => acc * input + c, 0);
}

export function getGradeAjustment(gradient, gapPolys)
{
    if (gradient>0)
    {
        return poly(gradient, gapPolys[0])
    }
    return poly(gradient, gapPolys[1])
}

function predictedSpeed(params, seg, cumulativeLkm)
{
    let fatigue = getFatigueMultiplier(params,  cumulativeLkm);
    return params.baseSpeed * fatigue / seg.gradAdj;
}

export function predict(segments, checkPoints, params)
{
    let cumulativeLkm = 0;
    let cumulativeDuration = 0;
    for (const seg of segments)
    {
        let segLkm = seg.dist / 1000 + seg.totalAscent / 100;
        let speed = predictedSpeed(params, seg, cumulativeLkm);
        let duration = seg.dist / speed / 60;  // minutes
        //seg[params.name + 'Duration'] = duration
        cumulativeDuration += duration;
        cumulativeLkm += segLkm;

        if (seg.checkptIdx != null)
        {
            checkPoints[seg.checkptIdx][params.name+"Duration"] = cumulativeDuration
        }
    }
}

// Nelder-Mead simplex optimizer — ported from old/old_index.html, generalized
// to n dimensions (that version was hardcoded to 3 params; here it's driven
// entirely by x0.length so it works for the 2-param onset/lambda fit too).
// No gradient needed, which suits this well: the cost surface (sum of
// squared residuals against real, noisy checkpoint crossings) isn't smooth
// enough to trust a gradient-based method on.
export function nelderMead(f, x0, maxIter = 2000, tol = 1e-8) {
    const n = x0.length;
    let s = [x0.slice()];
    for (let i = 0; i < n; i++) {
        const v = x0.slice(); v[i] = v[i] !== 0 ? v[i] * 1.1 : 0.025; s.push(v);
    }
    let fv = s.map(f);
    for (let iter = 0; iter < maxIter; iter++) {
        const ord = [...Array(n + 1).keys()].sort((a, b) => fv[a] - fv[b]);
        s = ord.map(i => s[i]); fv = ord.map(i => fv[i]);
        if (fv[n] - fv[0] < tol) break;
        const c = Array(n).fill(0);
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += s[i][j] / n;
        const xr = c.map((ci, j) => 2 * ci - s[n][j]); const fr = f(xr);
        if (fr < fv[0]) {
            const xe = c.map((ci, j) => 3 * ci - 2 * s[n][j]); const fe = f(xe);
            [s[n], fv[n]] = fe < fr ? [xe, fe] : [xr, fr];
        } else if (fr < fv[n - 1]) {
            [s[n], fv[n]] = [xr, fr];
        } else {
            const xc = c.map((ci, j) => 0.5 * (ci + s[n][j])); const fc = f(xc);
            if (fc < fv[n]) { [s[n], fv[n]] = [xc, fc]; }
            else { for (let i = 1; i <= n; i++) { s[i] = s[0].map((v, j) => 0.5 * (v + s[i][j])); fv[i] = f(s[i]); } }
        }
    }
    return s[0];
}