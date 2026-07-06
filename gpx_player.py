#!/usr/bin/env python3
"""
gpx_player.py — replays a GPX track against a /log endpoint for dev testing.

Mimics the GPSLogger "Custom URL" format used by server.py:
    GET <url>/log?c=lat,lon,alt,ts,bat,mz

Behavior:
  1. Lingers at the start point for --linger simulated seconds.
  2. Replays the track, interpolating between GPX trackpoints by distance so
     movement looks continuous regardless of how sparsely the original
     points are spaced.
  3. Adds Gaussian positional noise (--noise, meters) to every emitted point.

The simulated race clock and the real wall-clock delay between HTTP sends
are independent:
  - --speed (m/s) and --interval (simulated seconds between GPS fixes)
    control the *ts* field and how far each ping advances along the route —
    this is what should reflect a real, plausible running/hiking pace, since
    it's what the app's pace/forecast calculations will see.
  - --burst-delay / --replay-delay control how fast *we* deliver those pings
    in real time — this is the actual fast-forward knob, and can be as fast
    as your server can handle without changing the simulated pace at all.
  - --burst-until (km) switches from --burst-delay to the slower
    --replay-delay once that distance is reached, so you can get a big
    chunk of history almost instantly, then watch the remainder unfold at a
    more observable (but still accelerated) rate.

--start-time anchors the simulated ts values (default: now). Set this to
match the server's configured race start time (see startTime in
templates/main.html.jinja) for a clean test run. If it doesn't match, the
app's own start-time sanity check (see main.js) should kick in and correct
itself from the 2nd checkpoint crossing — deliberately mismatching this is
also a reasonable way to test that feature specifically.

Usage:
  python gpx_player.py track.gpx --url http://localhost:8017 \
      --speed 2.0 --interval 10 --start-time 2026-07-15T05:00:00 \
      --burst-until 50 --burst-delay 0.02 --replay-delay 0.5
"""
import argparse
import math
import random
import time
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime

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


def parse_start_time(s):
    """Accepts an ISO8601 string (naive = local time) and returns epoch seconds."""
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.astimezone()  # interpret naive datetimes as local time
    return dt.timestamp()


def send_log(base_url, lat, lon, ele, ts, bat, mz, timeout=5):
    c = f"{lat:.7f},{lon:.7f},{ele:.1f},{int(ts)},{bat},{mz}"
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
    ap.add_argument("--speed", type=float, default=2.0,
                    help="Simulated pace in m/s — drives the ts field, should be realistic (default 2.0)")
    ap.add_argument("--interval", type=float, default=10.0,
                    help="Simulated seconds between GPS fixes — drives the ts field (default 10)")
    ap.add_argument("--start-time", type=parse_start_time, default=None,
                    help="ISO8601 simulated race start, e.g. 2026-07-15T05:00:00. "
                         "Match the server's configured startTime for a clean run, "
                         "or mismatch it deliberately to test the start-time sanity check. "
                         "Default: now.")
    ap.add_argument("--burst-until", type=float, default=None,
                    help="Distance in km up to which pings are sent almost instantly (default: disabled)")
    ap.add_argument("--burst-delay", type=float, default=0.02,
                    help="Real seconds between sends while below --burst-until (default 0.02)")
    ap.add_argument("--replay-delay", type=float, default=0.3,
                    help="Real seconds between sends once past --burst-until, or throughout if unset (default 0.3)")
    ap.add_argument("--linger", type=float, default=10.0,
                    help="Simulated seconds to linger at start before moving (default 10)")
    ap.add_argument("--noise", type=float, default=2.0, help="Gaussian noise stddev in meters (default 2)")
    ap.add_argument("--bat", type=int, default=85, help="Fake battery percentage to report (default 85)")
    ap.add_argument("--mz", default="sim", help="Value for the 'mz' field (default 'sim')")
    ap.add_argument("--dry-run", action="store_true", help="Print points instead of sending HTTP requests")
    args = ap.parse_args()

    points = parse_gpx(args.gpx_file)
    cum_dist = build_cumulative_distances(points)
    total_dist = cum_dist[-1]
    print(f"Loaded {len(points)} trackpoints, total length {total_dist/1000:.2f} km")

    start_lat, start_lon, start_ele = points[0]
    sim_start_ts = args.start_time if args.start_time is not None else time.time()
    burst_until_m = args.burst_until * 1000.0 if args.burst_until is not None else None

    def real_delay(traveled_m):
        if burst_until_m is not None and traveled_m < burst_until_m:
            return args.burst_delay
        return args.replay_delay

    def emit(lat, lon, ele, ts, traveled_m, label):
        nlat, nlon = add_noise(lat, lon, args.noise)
        print(f"[{label}] lat={nlat:.6f} lon={nlon:.6f} ele={ele:.1f} "
              f"sim_ts={datetime.fromtimestamp(ts).isoformat(timespec='seconds')}")
        if not args.dry_run:
            send_log(args.url, nlat, nlon, ele, ts, args.bat, args.mz)
        time.sleep(real_delay(traveled_m))

    # 1. Linger at start — simulated clock still advances, but real delay
    # stays at burst pace since pre-race waiting isn't interesting to watch.
    sim_ts = sim_start_ts
    linger_end_sim = sim_ts + args.linger
    print(f"\n--- Lingering at start for {args.linger:.0f} simulated s ---")
    while sim_ts < linger_end_sim:
        emit(start_lat, start_lon, start_ele, sim_ts, 0.0, "linger")
        sim_ts += args.interval

    # 2. Replay along the track. Distance and ts both advance by
    # speed * interval per simulated step, independent of real delay.
    print(f"\n--- Replaying at {args.speed:.2f} m/s simulated pace, "
          f"fix every {args.interval:.0f} simulated s ---")
    if burst_until_m is not None:
        print(f"    burst mode below {args.burst_until:.1f} km "
              f"({args.burst_delay:.3f}s/send), then {args.replay_delay:.3f}s/send after")
    traveled = 0.0
    sim_step = args.speed * args.interval
    while traveled < total_dist:
        lat, lon, ele = interpolate_at_distance(points, cum_dist, traveled)
        pct = 100 * traveled / total_dist
        emit(lat, lon, ele, sim_ts, traveled, f"replay {pct:5.1f}%")
        traveled += sim_step
        sim_ts += args.interval

    # final point exactly at the end
    lat, lon, ele = points[-1]
    emit(lat, lon, ele, sim_ts, total_dist, "finish")
    print("\nDone.")


if __name__ == "__main__":
    main()
