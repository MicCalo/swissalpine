export class Checkpoint {
    constructor(point, trackSegments, hidden) {
        this._point = point;       
        this._hidden = hidden
        this._segments = trackSegments;
    }
    get name()      { return this._point.name; }
    get segIdx()    { return this._point.seg_idx; } 
    get seg()       { return this._segments[this.segIdx]; }
    get lat()       { return this._point.lat; }
    get lon()       { return this._point.lon; }
    get cumDist()   { return this.seg.cumDist; }
    get cumLkm()    { return this.seg.cumLkm; }
    get cumAscent() { return this.seg.cumAscent; }
    get cumDescent(){ return this.seg.cumDescent; }
    get ele()       { return this.seg.ele; }
}