import { getGradeAjustment  } from '/static/model.js';
import { Checkpoint } from '/static/checkpoint.js';

export function initializeSegments(trackSegments, trackPoints, gapPolys){
    let cumLkm = 0;
    let cumDist = 0;
    let cumAscent = 0;
    let cumDescent = 0;
    let lastCp = null
    
    for (const seg of trackSegments) { 
        seg.checkptIdx = null;

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
        let segLkm = seg.totalAscent / 100 + segDistKm
        cumDist += segDistKm;
        cumLkm += segLkm;
        cumAscent += seg.totalAscent;
        cumDescent += seg.totalDescent;
    
        seg.cumDist = cumDist;
        seg.cumLkm = cumLkm;
        seg.cumAscent = cumAscent;
        seg.cumDescent = cumDescent;
    }
}

export function initializeCheckPoints(trackSegments, trackPoints){
    // Checkpoint list: named track points
    let checkPoints = trackPoints
        .filter(p => p.name)
        .map(p => (new Checkpoint(p, trackSegments, false)));
    /*
        {
        name:    p.name,
        ele:     p.ele,
        lat:     p.lat,
        lon:     p.lon,
        seg_idx: p.seg_idx,
        hidden: false,
        cumDist: null,
        cumLkm: null
    }));
    */

    let lastCp = null;
    for(const cp of checkPoints){
        if (lastCp){
            cp.lastCheckpoint = lastCp;
        }
        lastCp = cp;
    }

    // Make sure we have about 2 Check-pts per lkm
    introduceHiddenCheckpoints(checkPoints, trackSegments, trackPoints);

    checkPoints.forEach((cp, i) => {
        trackSegments[cp.segIdx].checkptIdx = i;
    });
    /*
    for (const seg of trackSegments) { 
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
    */
    return checkPoints;
}

// Binary search: trackSegments is sorted ascending by cumLkm.
function findSegment(trackSegments, lkm){
    let lo = 0;
    let hi = trackSegments.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (trackSegments[mid].cumLkm < lkm) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    if (lo > 0 && Math.abs(trackSegments[lo - 1].cumLkm - lkm) <= Math.abs(trackSegments[lo].cumLkm - lkm)) {
        return trackSegments[lo - 1];
    }
    return trackSegments[lo];
}

function introduceHiddenCheckpoints(checkPoints, trackSegments, trackPoints){
    let lastCp = null;
   
    for(const cp of checkPoints){
        if (lastCp){
            let divisions = Math.round((cp.lkm / 0.5) / 2) * 2;
            let divLkm = cp.lkm / divisions;
            let pos = lastCp.cumLkm + divLkm;
            for (let i = 0; i < divisions-1; i++){
                let seg = findSegment(trackSegments, pos);
                let hiddenCp = new Checkpoint(trackPoints[seg.end_idx], trackSegments, true);
                checkPoints.push(hiddenCp);
                pos += divLkm;                
            }
        }
        lastCp = cp;
    }

    checkPoints.sort((a, b) => a.cumLkm - b.cumLkm);

    for(const cp of checkPoints){
        console.info(`Checkpoint: ${cp.name} ${cp.cumLkm.toFixed(2)} lkm, ${cp.cumDist.toFixed(2)} km, ${cp.cumAscent.toFixed(0)} m up, ${cp.cumDescent.toFixed(0)} m down, hidden: ${cp.hidden}`);
    }
}
