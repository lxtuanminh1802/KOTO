"""Engine contract. The URD specifies AI at input/output level; any model stack can sit behind this interface.

An engine walks the video at the requested analysis FPS and reports:
  - progress(pct)            as batches finish (drives the UI progress bar),
  - track(result)            as soon as a track is solid enough to match against the watchlist (early alert, WF-03),
and finally returns every track.
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Protocol


@dataclass
class TrackResult:
    track_id: str  # P01 / X01
    kind: str  # "person" | "vehicle"
    t_in: float
    t_out: float
    boxes: list[dict]  # [{t, x, y, w, h}] in % of frame, sampled at the analysis FPS
    confidence: float
    attributes: dict = field(default_factory=dict)
    plate_text: str | None = None
    plate_confidence: float | None = None
    plate_alternatives: list[dict] = field(default_factory=list)
    identity: str | None = None  # re-ID hint (appearance signature or ground truth id)
    face_box: dict | None = None  # {t, x, y, w, h} best frontal face, % of frame
    best_t: float | None = None  # moment used for the crop thumbnail
    face_vector: list[float] | None = None  # embedding straight from the model; None = compute from the face crop


@dataclass
class VideoInfo:
    path: Path
    duration: float
    width: int
    height: int
    native_fps: float
    truth: Path | None = None  # ground-truth sidecar for generated demo footage
    seed: str = ""


ProgressFn = Callable[[float], None]
TrackFn = Callable[[TrackResult], None]


class Engine(Protocol):
    name: str

    def analyze(self, video: VideoInfo, fps: float, modes: dict, on_progress: ProgressFn, on_track: TrackFn) -> list[TrackResult]: ...


def apply_modes(t: TrackResult, modes: dict) -> TrackResult | None:
    """UR-ANA-04: keep only what the selected modes produce."""
    p, v = modes.get("person", {}), modes.get("vehicle", {})
    if t.kind == "person":
        if not any(p.values()):
            return None
        a = dict(t.attributes)
        if not p.get("attr"):
            for k in ("top", "top_color", "bottom", "bottom_color", "accessories"):
                a.pop(k, None)
        if not p.get("mask"):
            a.pop("mask", None)
        if not p.get("gait"):
            a.pop("gait", None)
        if not p.get("face") or a.get("mask"):
            t.face_box, t.face_vector = None, None
        t.attributes = a
    else:
        if not any(v.values()):
            return None
        a = dict(t.attributes)
        if not v.get("color"):
            a.pop("color", None)
        t.attributes = a
        if not v.get("plate"):
            t.plate_text, t.plate_confidence, t.plate_alternatives = None, None, []
    return t


def get_engine(name: str) -> Engine:
    if name == "opencv":
        from .cv import OpenCVEngine

        return OpenCVEngine()
    from .simulated import SimulatedEngine

    return SimulatedEngine()
