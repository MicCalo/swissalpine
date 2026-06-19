from typing import NamedTuple
from coordinate import Coord

Segment = NamedTuple("Segment", [("id", int), ("coord", Coord)])

def parse_segments(filename: str) -> list[Segment]:
    segments = []
    is_header = True
    with open(filename, "r") as f:
        for line in f:            
            tokens = line.strip().split(";")
            if is_header:
                is_header = False
                continue
            id = int(tokens[0])
            lat = float(tokens[1])
            lon = float(tokens[2])
            segments.append(Segment(id, Coord(lat, lon)))
    return segments