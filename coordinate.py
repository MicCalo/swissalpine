
from typing import NamedTuple
import math

Coord = NamedTuple("Coord", [("lat", float), ("lon", float)])

def distance(a: Coord, b: Coord) -> float:
    """ 
    cos(d) = sin(φА)·sin(φB) + cos(φА)·cos(φB)·cos(λА − λB),
    where φА, φB are latitudes and λА, λB are longitudes
    Distance = d * R
    """
    R = 6371; # km

    sLat1 = math.sin(to_radians(a.lat))
    sLat2 = math.sin(to_radians(b.lat))
    cLat1 = math.cos(to_radians(a.lat))
    cLat2 = math.cos(to_radians(b.lat))
    cLon = math.cos(to_radians(a.lon) - to_radians(b.lon))

    cosD = sLat1 * sLat2 + cLat1 * cLat2 * cLon

    d = math.acos(cosD)

    dist = R * d

    return dist

def to_radians(deg: float) -> float:
    return deg * math.pi / 180.0