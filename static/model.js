function getFatigueMultiplier(model, cumulativeGapKm)
{
    if (cumulativeGapKm <= model.onset) return 1.0;
    return model.floor + (1.0 - model.floor) * Math.Exp(-model.lambda * (cumulativeGapKm - model.onset));
}

function poly(input, poly){
    let result = poly[0];

    let term = input;
    result += term * poly[1];

    term *= input;
    result += term * poly[2];
    if (poly.length == 3) return result;

    term *= input;
    result += term * poly[3];
    if (poly.length == 4) return result;

    term *= input;
    result += term * poly[4];
    if (poly.length == 5) return result;

    throw "not supported";
}

function getGradeAjustment(gradient, gapPolys)
{
    if (gradient>0)
    {
        return poly(gradient, gapPolys[0])
    }
    return poly(gradient, gapPolys[1])
}

function predictedSpeed(model, seg, cumulativeGapKm, baseSpeed)
{
    //let gradeAdjustment = _gradeAdjustment.Evaluate(seg.Gradient);
    let fatigue = getFatigueMultiplier(model,  cumulativeGapKm);
    return baseSpeed * fatigue / gradeAdjustment;
}

function predict(segments, model)
{
    let cumulativeGapKm = 0;
    for (const seg of segments)
    {
        let segGapKm = seg.grade * seg.distance / 1000.0;
        //let speed = PredictedSpeed(seg, cumulativeLkm, flatSpeed);
        cumulativeGapKm += segGapKm;
    }
}