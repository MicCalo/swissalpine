from dataclasses import dataclass, field
from typing import List
from data_model.coordinate import Coord
from data_model.data_point import DataPoint
import xml.etree.ElementTree as ET
import logging


@dataclass
class Segment:
    start_idx: int
    end_idx: int
    _track: 'Track'

    _extra: dict = field(default_factory=dict, repr=False, init=False)

    def __init__(self, track: 'Track', start_idx: int, end_idx: int):
        self._track = track
        self.start_idx = start_idx
        self.end_idx = end_idx

    def __getattr__(self, name: str):
        try:
            return self.__dict__["_extra"][name]
        except KeyError:
            raise AttributeError(name)

    def __setattr__(self, name: str, value):
        if name in {"id", "coord", "_extra"}:
            object.__setattr__(self, name, value)
        else:
            self.__dict__.setdefault("_extra", {})[name] = value

    @property
    def start(self) -> DataPoint:
        return self._track.points[self.start_idx]

    @property
    def end(self) -> DataPoint:
        return self._track.points[self.end_idx]