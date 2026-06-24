from dataclasses import dataclass, field
from typing import List
from data_model.data_point import DataPoint
from data_model.segment import Segment
import xml.etree.ElementTree as ET
import logging
from data_model.terrain_segmenter import segment_track

@dataclass
class Track:
    points: List[DataPoint]
    segments: List[Segment]

    def __init__(self, gpx_file: str):       
        tree = ET.parse(gpx_file)
        root = tree.getroot()
        trk = root.find('trk', {'': 'http://www.topografix.com/GPX/1/1'})
        trk_seg = trk.find('trkseg', {'': 'http://www.topografix.com/GPX/1/1'})
        
        self.points = [DataPoint(e) for e in trk_seg]
        self.segments = segment_track(self)

        # assign segment indices to points
        i = 0
        for seg in self.segments:
            for pt_idx in range(seg.start_idx, seg.end_idx):
                self.points[pt_idx].segment_idx = i
            i+=1
        #as last point of a segment is also first point of next segment, and rage is exclusive last, the very last point is not assigned
        self.points[-1].segment_idx = self.points[-2].segment_idx 

    def points_as_csv(self):
        yield "lat,lon,ele,seg_idx\n"
        for p in self.points:
            yield f"{p.coord.lat},{p.coord.lon},{p.elevation},{p.segment_idx}\n"
    
    def segments_as_csv(self):
        yield "start_idx,end_idx,dist\n"
        for s in self.segments:
            yield f"{s.start_idx},{s.end_idx},{s.dist:.2f}\n"