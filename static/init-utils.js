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
}
