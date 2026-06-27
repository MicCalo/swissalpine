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

        if (seg.checkpt_idx != null)
        {
            checkPoints[seg.checkpt_idx][params.name+"Duration"] = cumulativeDuration
        }
    }
}