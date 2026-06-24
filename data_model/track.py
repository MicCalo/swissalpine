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

    @property
    def points_as_js_array(self):
           return f"[{','.join([f'[{s.coord.lat},{s.coord.lon}]' for s in self.points])}]"