import statistics
from typing import List
from data_model.data_point import DataPoint
from data_model.segment import Segment
from data_model.coordinate import distance


def _smooth_altitude(points: List[DataPoint], window_size: int) -> List[float]:
    half = window_size // 2
    result = []
    for i in range(len(points)):
        lo = max(0, i - half)
        hi = min(len(points) - 1, i + half)
        window = [getattr(points[j], "elevation", 0.0) for j in range(lo, hi + 1)]
        result.append(statistics.median(window))
    return result


def _cumulative_distances(points: List[DataPoint]) -> List[float]:
    """Cumulative distance in meters along the track."""
    dists = [0.0]
    for i in range(1, len(points)):
        d = distance(points[i - 1].coord, points[i].coord) * 1000.0  # km → m
        dists.append(dists[-1] + d)
    return dists


def _build_segment(
    track: 'Track',
    smoothed: List[float],
    dists: List[float],
    start: int,
    end: int,
) -> Segment:
    dist_m = dists[end] - dists[start]
    alt_delta = smoothed[end] - smoothed[start]
    gradient = alt_delta / dist_m if dist_m > 0 else 0.0

    seg = Segment(track=track, start_idx=start, end_idx=end)
    seg.dist = dist_m
    seg.alt_delta = alt_delta
    seg.gradient = gradient
    return seg


def segment_track(
    track: 'Track',
    min_dist_m: float = 50.0,
    max_dist_m: float = 500.0,
    grad_threshold_pct: float = 3.0,
    smoothing_window: int = 11,
) -> List[Segment]:
    if len(track.points) < 2:
        return []

    smoothed = _smooth_altitude(track.points, smoothing_window)
    dists = _cumulative_distances(track.points)
    segments: List[Segment] = []
    seg_start = 0

    for i in range(1, len(track.points)):
        dist_so_far = dists[i] - dists[seg_start]
        if dist_so_far <= 0:
            continue

        alt_delta_seg = smoothed[i] - smoothed[seg_start]
        grad_seg = alt_delta_seg / dist_so_far * 100.0

        dd = dists[i] - dists[i - 1]
        da = smoothed[i] - smoothed[i - 1]
        grad_local = da / dd * 100.0 if dd > 0 else 0.0

        too_long = dist_so_far >= max_dist_m
        gradient_break = (
            dist_so_far >= min_dist_m
            and abs(grad_local - grad_seg) > grad_threshold_pct
        )

        if too_long or gradient_break:
            segments.append(_build_segment(track, smoothed, dists, seg_start, i))
            seg_start = i

    last = len(track.points) - 1
    if seg_start < last:
        remaining = dists[last] - dists[seg_start]
        if remaining < min_dist_m and segments:
            prev_start = segments[-1].start_idx
            segments[-1] = _build_segment(track, smoothed, dists, prev_start, last)
        else:
            segments.append(_build_segment(track, smoothed, dists, seg_start, last))

    return segments
