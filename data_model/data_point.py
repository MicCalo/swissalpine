from dataclasses import dataclass, field
from data_model.coordinate import Coord
import xml.etree.ElementTree as ET
import logging

@dataclass
class DataPoint:
    coord: Coord
    _extra: dict = field(default_factory=dict, repr=False, init=False)

    def __init__(self, gpx_element: ET.Element):
        lat = float(gpx_element.get("lat"))
        lon = float(gpx_element.get("lon"))
        self.coord = Coord(lat, lon)
        for ch in gpx_element:
            if ch.tag.endswith('ele'):
                self.elevation = float(ch.text)
            elif ch.tag.endswith('name'):
                self.name = ch.text
            elif ch.tag.endswith('extensions'):
                pass
            else:
                logging.info(f"Unknown element child '{ch.tag}'")

    def __getattr__(self, name: str):
        try:
            return self.__dict__["_extra"][name]
        except KeyError:
            if name == 'name':
                return ''
            raise AttributeError(name)

    def __setattr__(self, name: str, value):
        if name in {"id", "coord", "_extra"}:
            object.__setattr__(self, name, value)
        else:
            self.__dict__.setdefault("_extra", {})[name] = value
    