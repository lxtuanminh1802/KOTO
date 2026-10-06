"""Classic computer-vision engine (VMA_AI_ENGINE=opencv): real boxes on real footage, no GPU, no model downloads.

- Moving objects: MOG2 background subtraction + contours, tracked frame to frame by IoU.
- Person vs vehicle: box shape and size (tall and narrow = person, wide = vehicle).
- Attributes: dominant colour of the upper / lower body (people) or body (vehicles), mapped to the 14-colour palette.
- Faces: OpenCV Haar cascade inside the head region; the crop feeds the same feature path as watchlist photos.
- Plates: not read. Plug an OCR model in here (UR-ANA-03) when the unit picks one.

It is a functional baseline for fixed CCTV cameras, not a substitute for a trained detector.
"""

from dataclasses import dataclass, field

import cv2
import numpy as np

from ..domain import nearest_color
from .base import TrackResult, VideoInfo, apply_modes

WORK_W = 640


@dataclass
class _Track:
    kind: str
    boxes: list = field(default_factory=list)  # (t, x, y, w, h) in work pixels
    frames: list = field(default_factory=list)  # (t, frame) samples for attributes
    last_t: float = 0.0
    hits: int = 0
    emitted: bool = False


def _iou(a, b) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    ix, iy = max(ax, bx), max(ay, by)
    ux, uy = min(ax + aw, bx + bw), min(ay + ah, by + bh)
    inter = max(0, ux - ix) * max(0, uy - iy)
    union = aw * ah + bw * bh - inter
    return inter / union if union else 0.0


def _dominant(img: np.ndarray) -> str | None:
    if img.size == 0:
        return None
    px = img.reshape(-1, 3).astype(np.float32)
    rgb = np.median(px, axis=0)[::-1]  # BGR → RGB
    return nearest_color(rgb)


class OpenCVEngine:
    name = "opencv"

    def __init__(self) -> None:
        self.faces = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")

    def analyze(self, video: VideoInfo, fps: float, modes: dict, on_progress, on_track) -> list[TrackResult]:
        cap = cv2.VideoCapture(str(video.path))
        native = cap.get(cv2.CAP_PROP_FPS) or video.native_fps or 25
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or int(video.duration * native)
        step = max(1, round(native / max(fps, 0.1)))
        sub = cv2.createBackgroundSubtractorMOG2(history=300, varThreshold=32, detectShadows=True)
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        active: list[_Track] = []
        done: list[_Track] = []
        counters = {"person": 0, "vehicle": 0}
        results: list[TrackResult] = []
        W = H = 0
        idx = 0

        def finish(tr: _Track):
            res = self._result(tr, W, H, counters, modes)
            if res:
                results.append(res)
                on_track(res)

        while True:
            ok = cap.grab()
            if not ok:
                break
            if idx % step:
                idx += 1
                continue
            ok, frame = cap.retrieve()
            if not ok:
                break
            t = idx / native
            idx += 1
            scale = WORK_W / frame.shape[1]
            small = cv2.resize(frame, (WORK_W, int(frame.shape[0] * scale)))
            H, W = small.shape[:2]
            mask = sub.apply(small)
            if idx < step * 5:  # let the background model settle
                continue
            mask = cv2.threshold(mask, 200, 255, cv2.THRESH_BINARY)[1]
            mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
            mask = cv2.dilate(cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2), kernel)
            contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            boxes = []
            for c in contours:
                x, y, w, h = cv2.boundingRect(c)
                if w * h < W * H * 0.002:
                    continue
                kind = "person" if h > 1.3 * w else "vehicle" if w > 1.1 * h and w * h > W * H * 0.01 else None
                if kind:
                    boxes.append((kind, (x, y, w, h)))
            for kind, b in boxes:
                best = max((tr for tr in active if tr.kind == kind), key=lambda tr: _iou(tr.boxes[-1][1:], b), default=None)
                if best is None or _iou(best.boxes[-1][1:], b) < 0.15:
                    best = _Track(kind=kind)
                    active.append(best)
                best.boxes.append((t, *b))
                best.hits += 1
                best.last_t = t
                if len(best.frames) < 6 and best.hits % 3 == 1:
                    best.frames.append((t, small.copy(), b))
            for tr in [tr for tr in active if t - tr.last_t > 1.5]:
                active.remove(tr)
                finish(tr)
            if total:
                on_progress(min(99.0, 100.0 * idx / total))
        cap.release()
        for tr in active:
            finish(tr)
        return results

    def _result(self, tr: _Track, W: int, H: int, counters: dict, modes: dict) -> TrackResult | None:
        if tr.hits < 3 or not W:
            return None
        counters[tr.kind] += 1
        tid = ("P" if tr.kind == "person" else "X") + f"{counters[tr.kind]:02d}"
        boxes = [{"t": round(t, 2), "x": round(x / W * 100, 2), "y": round(y / H * 100, 2), "w": round(w / W * 100, 2), "h": round(h / H * 100, 2)} for t, x, y, w, h in tr.boxes]
        big_t, _, img, (x, y, w, h) = max(((ft, w * h, img, (x, y, w, h)) for ft, img, (x, y, w, h) in tr.frames), key=lambda z: z[1], default=(tr.boxes[0][0], 0, None, tr.boxes[0][1:]))
        attrs: dict = {}
        face_box = None
        if img is not None:
            crop = img[y:y + h, x:x + w]
            if tr.kind == "person":
                attrs["top_color"] = _dominant(crop[int(h * 0.2):int(h * 0.5)])
                attrs["bottom_color"] = _dominant(crop[int(h * 0.55):int(h * 0.85)])
                head = cv2.cvtColor(crop[: max(1, int(h * 0.35))], cv2.COLOR_BGR2GRAY)
                found = self.faces.detectMultiScale(head, 1.1, 4, minSize=(12, 12)) if not self.faces.empty() and head.size else []
                if len(found):
                    fx, fy, fw, fh = max(found, key=lambda f: f[2] * f[3])
                    face_box = {"t": big_t, "x": (x + fx) / W * 100, "y": (y + fy) / H * 100, "w": fw / W * 100, "h": fh / H * 100}
                attrs = {k: v for k, v in attrs.items() if v}
            else:
                attrs["vehicle_type"] = "car"
                col = _dominant(crop[int(h * 0.3):int(h * 0.8)])
                if col:
                    attrs["color"] = col
        conf = min(95.0, 55.0 + tr.hits * 2.5)
        res = TrackResult(track_id=tid, kind=tr.kind, t_in=boxes[0]["t"], t_out=boxes[-1]["t"], boxes=boxes, confidence=round(conf), attributes=attrs,
                          identity=f"cv:{tr.kind}:{attrs.get('top_color', attrs.get('color'))}:{attrs.get('bottom_color', '')}", face_box=face_box, best_t=big_t)
        return apply_modes(res, modes)
