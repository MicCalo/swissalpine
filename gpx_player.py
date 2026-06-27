#!/usr/bin/env python3
"""
gpx_player.py — replays a GPX track against a /log endpoint for dev testing.

Mimics the GPSLogger "Custom URL" format used by server.py:
    GET <url>/log?c=lat,lon,alt,ts,bat,mz

Behavior:
  1. Lingers at the start point for --linger seconds, sending periodic pings.
  2. Replays the track at a fixed speed (--speed, m/s), interpolating between
     GPX trackpoints by distance so movement looks continuous regardless of
     how sparsely the original points are spaced.
  3. Adds Gaussian positional noise (--noise, meters) to every emitted point.

Usage:
  python gpx_player.py track.gpx --url https://calonder.synology.me or http://localhost:8017 \
      --speed 2.5 --linger 60 --interval 5 --noise 4
"""
import argparse
import math
import random
import sys
import time
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET

GPX_NS = {"gpx": "http://www.topografix.com/GPX/1/1"}
EARTH_R = 6371000.0  # meters


def parse_gpx(path):
    """Returns list of (lat, lon, ele) in track order."""
    tree = ET.parse(path)
    root = tree.getroot()
    points = []
    for trkpt in root.findall(".//gpx:trkpt", GPX_NS):
        lat = float(trkpt.get("lat"))
        lon = float(trkpt.get("lon"))
        ele_el = trkpt.find("gpx:ele", GPX_NS)
        ele = float(ele_el.text) if ele_el is not None else 0.0
        points.append((lat, lon, ele))
    if len(points) < 2:
        raise ValueError("GPX track needs at least 2 points")
    return points


def haversine_m(lat1, lon1, lat2, lon2):
    """Distance in meters between two lat/lon points."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return 2 * EARTH_R * math.asin(math.sqrt(a))


def build_cumulative_distances(points):
    """Returns list of cumulative distance (m) at each point, dist[0] = 0."""
    dist = [0.0]
    for i in range(1, len(points)):
        lat1, lon1, _ = points[i - 1]
        lat2, lon2, _ = points[i]
        dist.append(dist[-1] + haversine_m(lat1, lon1, lat2, lon2))
    return dist


def interpolate_at_distance(points, cum_dist, target_dist):
    """Find the (lat, lon, ele) at a given cumulative distance along the track."""
    total = cum_dist[-1]
    if target_dist <= 0:
        return points[0]
    if target_dist >= total:
        return points[-1]

    # binary search for the segment containing target_dist
    lo, hi = 0, len(cum_dist) - 1
    while lo < hi - 1:
        mid = (lo + hi) // 2
        if cum_dist[mid] <= target_dist:
            lo = mid
        else:
            hi = mid

    seg_len = cum_dist[hi] - cum_dist[lo]
    frac = 0.0 if seg_len == 0 else (target_dist - cum_dist[lo]) / seg_len

    lat1, lon1, ele1 = points[lo]
    lat2, lon2, ele2 = points[hi]
    lat = lat1 + (lat2 - lat1) * frac
    lon = lon1 + (lon2 - lon1) * frac
    ele = ele1 + (ele2 - ele1) * frac
    return (lat, lon, ele)


def add_noise(lat, lon, noise_m):
    """Add Gaussian noise (meters, stddev) to a lat/lon point."""
    if noise_m <= 0:
        return lat, lon
    # random offset in meters, split into north/east components
    dn = random.gauss(0, noise_m)
    de = random.gauss(0, noise_m)
    dlat = dn / 111320.0  # meters per degree latitude, ~constant
    dlon = de / (111320.0 * math.cos(math.radians(lat)) or 1e-9)
    return lat + dlat, lon + dlon


def send_log(base_url, lat, lon, ele, bat, mz, timeout=5):
    c = f"{lat:.7f},{lon:.7f},{ele:.1f},{int(time.time())},{bat},{mz}"
    url = f"{base_url.rstrip('/')}/log?{urllib.parse.urlencode({'c': c})}"
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            body = resp.read().decode(errors="replace")
            print(f"  -> {resp.status} {body}")
    except Exception as e:
        print(f"  -> ERROR: {e}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("gpx_file", help="Path to GPX track file")
    ap.add_argument("--url", required=True, help="Base URL of the server, e.g. http://localhost:8017")
    ap.add_argument("--speed", type=float, default=2.5, help="Replay speed in m/s (default 2.5 ~ 9 km/h jogging pace)")
    ap.add_argument("--interval", type=float, default=5.0, help="Seconds between pings (default 5)")
    ap.add_argument("--linger", type=float, default=10.0, help="Seconds to linger at start before moving (default 10)")
    ap.add_argument("--noise", type=float, default=4.0, help="Gaussian noise stddev in meters (default 4)")
    ap.add_argument("--bat", type=int, default=85, help="Fake battery percentage to report (default 85)")
    ap.add_argument("--mz", default="sim", help="Value for the 'mz' field (default 'sim')")
    ap.add_argument("--dry-run", action="store_true", help="Print points instead of sending HTTP requests")
    args = ap.parse_args()

    points = parse_gpx(args.gpx_file)
    cum_dist = build_cumulative_distances(points)
    total_dist = cum_dist[-1]
    print(f"Loaded {len(points)} trackpoints, total length {total_dist/1000:.2f} km")

    start_lat, start_lon, start_ele = points[0]

    def emit(lat, lon, ele, label):
        nlat, nlon = add_noise(lat, lon, args.noise)
        print(f"[{label}] lat={nlat:.6f} lon={nlon:.6f} ele={ele:.1f}")
        if args.dry_run:
            return
        send_log(args.url, nlat, nlon, ele, args.bat, args.mz)

    # 1. Linger at start
    linger_end = time.time() + args.linger
    print(f"\n--- Lingering at start for {args.linger:.0f}s ---")
    while time.time() < linger_end:
        emit(start_lat, start_lon, start_ele, "linger")
        time.sleep(args.interval)

    # 2. Replay along the track at fixed speed
    print(f"\n--- Replaying at {args.speed:.2f} m/s, ping every {args.interval:.0f}s ---")
    traveled = 0.0
    step = args.speed * args.interval
    while traveled < total_dist:
        lat, lon, ele = interpolate_at_distance(points, cum_dist, traveled)
        pct = 100 * traveled / total_dist
        emit(lat, lon, ele, f"replay {pct:5.1f}%")
        traveled += step
        time.sleep(args.interval)

    # final point exactly at the end
    lat, lon, ele = points[-1]
    emit(lat, lon, ele, "finish")
    print("\nDone.")


if __name__ == "__main__":
    main()