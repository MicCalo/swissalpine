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

    // Make sure we have about 2 Check-pts per lkm
    introduceHiddenCheckpoints(checkPoints, trackSegments);

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

function introduceHiddenCheckpoints(checkPoints, trackSegments){
    let lastCp = null;
    for(const cp in checkPoints){
        if (lastCp){

        }
        lastCp = cp;
    }
}
