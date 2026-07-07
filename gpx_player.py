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

The simulated pace itself is not flat: at each step it's derived the same
way the app's own model.js does — a flat "base speed" (--speed) adjusted by
grade (GAP polynomials) and by cumulative fatigue (onset/lambda/floor), so
the simulated "actual" data has the same kind of terrain- and
fatigue-driven pace variation the app expects to fit against, rather than a
constant m/s regardless of climb/descent/fatigue. Those model constants
(GAP_ASCENT/GAP_DESCENT/FATIGUE_*, near the top of this file) mirror
gapPolys/targetParams in templates/main.html.jinja as of this writing —
keep them in sync by hand if you change those.

Usage:
  python gpx_player.py track.gpx --url http://localhost:8017 \
      --speed 2.0 --interval 10 --start-time 2026-07-15T05:00:00 \
      --burst-until 50 --burst-delay 0.02 --replay-delay 0.5
"""
import argparse
import bisect
import math
import random
import statistics
import time
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime

GPX_NS = {"gpx": "http://www.topografix.com/GPX/1/1"}
EARTH_R = 6371000.0  # meters

# GAP grade-adjustment polynomials and fatigue params — mirror
# gapPolys/targetParams in templates/main.html.jinja. Keep these in sync by
# hand if you change those.
GAP_ASCENT = [1.0719747552984284, 3.8950291039596086, 14.364768273050313, -17.79284965889736]
GAP_DESCENT = [1.0309165723755624, 1.7226517479035495, 10.11708013261488]
FATIGUE_ONSET = 40.0   # lkm
FATIGUE_LAMBDA = 0.020
FATIGUE_FLOOR = 0.55
MIN_GRAD_ADJ = 0.3  # numerical safety net against extreme/noisy raw-GPX grades
GRADE_SMOOTHING_WINDOW_M = 200.0  # rolling-median elevation window before computing any grade — matches the real TerrainSegmenter's ~200m max segment length
MIN_GRADE = -0.30   # matches the "-30%" descent cap mentioned for the real segmenter
MAX_GRADE = 0.50    # defensive ascent-side bound; real segmenter's exact cap is unconfirmed


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


def interpolate_scalar_at_distance(values, cum_dist, target_dist):
    """Same interpolation as interpolate_at_distance, but for a plain list
    of scalars (used for the smoothed elevation profile)."""
    total = cum_dist[-1]
    if target_dist <= 0:
        return values[0]
    if target_dist >= total:
        return values[-1]

    lo, hi = 0, len(cum_dist) - 1
    while lo < hi - 1:
        mid = (lo + hi) // 2
        if cum_dist[mid] <= target_dist:
            lo = mid
        else:
            hi = mid

    seg_len = cum_dist[hi] - cum_dist[lo]
    frac = 0.0 if seg_len == 0 else (target_dist - cum_dist[lo]) / seg_len
    return values[lo] + (values[hi] - values[lo]) * frac


def smooth_elevations(points, cum_dist, window_m=GRADE_SMOOTHING_WINDOW_M):
    """Rolling-median elevation smoothing by distance window, used only for
    grade/physics computation — real recorded GPS elevation is noisy enough
    (easily several meters of jitter) that raw point-to-point grade produces
    wild, sign-flipping apparent gradients feeding a nonlinear polynomial.
    This mirrors (approximately) the rolling-median smoothing the real
    TerrainSegmenter applies before grading, and is intentionally a
    separate profile from the one actually sent in each ping — the sent
    elevation should still look like realistic noisy GPS data.

    Near the start/finish, the window would otherwise be truncated to only
    one side (no terrain exists before 0 or after the total distance),
    which biases the median away from the true local terrain right at the
    boundary. Mirror-padding fills the missing side by reflecting the
    nearby in-range data back across the boundary, rather than leaving the
    window one-sided — the standard approach for edge handling in moving
    filters."""
    eles = [p[2] for p in points]
    total = cum_dist[-1]
    half = window_m / 2.0
    smoothed = []
    for i, d in enumerate(cum_dist):
        lo, hi = d - half, d + half
        lo_idx = bisect.bisect_left(cum_dist, max(lo, 0.0))
        hi_idx = bisect.bisect_right(cum_dist, min(hi, total))
        window_eles = list(eles[lo_idx:hi_idx])

        if lo < 0:
            # missing [lo, 0) reflected from (0, -lo]
            pad_hi_idx = bisect.bisect_right(cum_dist, -lo)
            window_eles.extend(eles[0:pad_hi_idx])
        if hi > total:
            # missing (total, hi] reflected from [total-(hi-total), total)
            pad_lo_idx = bisect.bisect_left(cum_dist, 2 * total - hi)
            window_eles.extend(eles[pad_lo_idx:])

        smoothed.append(statistics.median(window_eles) if window_eles else eles[i])
    return smoothed


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


def poly_eval(x, coeffs):
    """Horner's method, coeffs ascending (coeffs[i] = coefficient of x^i) —
    matches the reduceRight in static/model.js exactly."""
    result = 0.0
    for c in reversed(coeffs):
        result = result * x + c
    return result


def grade_adjustment(gradient):
    """Direct port of getGradeAjustment() in static/model.js."""
    if gradient > 0:
        return poly_eval(gradient, GAP_ASCENT)
    return poly_eval(gradient, GAP_DESCENT)


def fatigue_multiplier(cum_lkm):
    """Direct port of getFatigueMultiplier() in static/model.js."""
    if cum_lkm <= FATIGUE_ONSET:
        return 1.0
    return FATIGUE_FLOOR + (1.0 - FATIGUE_FLOOR) * math.exp(-FATIGUE_LAMBDA * (cum_lkm - FATIGUE_ONSET))


def local_grade(ele_here, ele_next, sub_dist_m):
    """Net gradient (fraction, e.g. 0.1 = 10%) of one raw point-to-point
    sub-segment, clamped to a plausible trail range as a defensive backstop
    against residual noise even after smoothing."""
    if sub_dist_m <= 0:
        return 0.0
    grade = (ele_next - ele_here) / sub_dist_m
    return max(MIN_GRADE, min(MAX_GRADE, grade))


def advance_by_time(points, cum_dist, smoothed_ele, total_dist, pos_m, cum_ascent_m, base_speed, interval_s):
    """Walk forward along the raw GPX points, consuming exactly interval_s
    seconds of simulated time. Each individual raw point-to-point
    sub-segment gets its own grade-and-fatigue-adjusted speed — rather than
    picking one speed for a whole lookahead window — so undulating terrain
    within a single ping-to-ping gap is integrated correctly instead of
    averaged before the (nonlinear) GAP polynomial sees it. This also
    sidesteps the chicken-and-egg problem of sizing a step from an assumed
    speed: we accumulate time directly against the route's own existing
    point spacing, so no step distance needs to be guessed up front.

    Grade (and hence cum_ascent) is computed from smoothed_ele, not the raw
    points' own elevation — see smooth_elevations() for why.

    Returns (new_pos_m, new_cum_ascent_m, first_grade, first_speed) — the
    grade/speed of the first sub-segment consumed are returned purely for
    the status line, reflecting the physics actually used right at the
    ping's starting point.
    """
    remaining = interval_s
    pos = pos_m
    cum_ascent = cum_ascent_m
    idx = bisect.bisect_right(cum_dist, pos)  # index of the next raw point ahead of pos
    first_grade, first_speed = None, None

    while remaining > 0 and pos < total_dist and idx < len(points):
        next_dist = cum_dist[idx]
        sub_dist = next_dist - pos
        if sub_dist <= 0:
            idx += 1
            continue

        ele_here = interpolate_scalar_at_distance(smoothed_ele, cum_dist, pos)
        ele_next = smoothed_ele[idx]
        grade = local_grade(ele_here, ele_next, sub_dist)
        grad_adj = max(grade_adjustment(grade), MIN_GRAD_ADJ)
        cum_lkm = pos / 1000.0 + cum_ascent / 100.0
        fatigue = fatigue_multiplier(cum_lkm)
        speed = base_speed * fatigue / grad_adj
        if first_grade is None:
            first_grade, first_speed = grade, speed
        sub_time = sub_dist / speed

        if sub_time <= remaining:
            # fully cross this raw sub-segment
            if ele_next > ele_here:
                cum_ascent += ele_next - ele_here
            pos = next_dist
            remaining -= sub_time
            idx += 1
        else:
            # interval_s worth of time ends partway through this sub-segment
            frac = remaining / sub_time
            pos += frac * sub_dist
            if ele_next > ele_here:
                cum_ascent += frac * (ele_next - ele_here)
            remaining = 0

    if first_grade is None:  # interval_s == 0, or already at the end
        first_grade, first_speed = 0.0, base_speed
    return pos, cum_ascent, first_grade, first_speed


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
    ap.add_argument("--speed", type=float, default=8.2 / 3.6,
                    help="Flat-ground base pace in m/s (baseSpeed) — actual pace is this "
                         "adjusted by grade and fatigue, same as the app's model (default 2.0)")
    ap.add_argument("--interval", type=float, default=120.0,
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
    smoothed_ele = smooth_elevations(points, cum_dist)
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

    # 2. Replay along the track. Each ping consumes exactly --interval
    # seconds of simulated time, integrated sub-segment by sub-segment over
    # the raw GPX points (see advance_by_time) — not a single speed applied
    # over a guessed step distance.
    print(f"\n--- Replaying with baseSpeed={args.speed:.2f} m/s, "
          f"onset={FATIGUE_ONSET:.0f}lkm, lambda={FATIGUE_LAMBDA:.3f}, floor={FATIGUE_FLOOR:.2f}, "
          f"fix every {args.interval:.0f} simulated s ---")
    if burst_until_m is not None:
        print(f"    burst mode below {args.burst_until:.1f} km "
              f"({args.burst_delay:.3f}s/send), then {args.replay_delay:.3f}s/send after")
    traveled = 0.0
    cum_ascent_m = 0.0
    while traveled < total_dist:
        lat, lon, ele = interpolate_at_distance(points, cum_dist, traveled)
        traveled, cum_ascent_m, grade, speed = advance_by_time(
            points, cum_dist, smoothed_ele, total_dist, traveled, cum_ascent_m, args.speed, args.interval)
        fatigue = fatigue_multiplier(traveled / 1000.0 + cum_ascent_m / 100.0)

        pct = 100 * traveled / total_dist
        emit(lat, lon, ele, sim_ts, traveled,
             f"replay {pct:5.1f}% grade={grade*100:5.1f}% fatigue={fatigue:.2f} spd={speed:.2f}m/s")
        sim_ts += args.interval

    # final point exactly at the end
    lat, lon, ele = points[-1]
    emit(lat, lon, ele, sim_ts, total_dist, "finish")
    print("\nDone.")


if __name__ == "__main__":
    main()
