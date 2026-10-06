"""Frame grabbing, crops and face features shared by the worker and the API."""

from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from ..engine.features import embed
from . import media

_CASCADE = None


def grab(video_path: Path, t: float) -> Image.Image | None:
    cap = cv2.VideoCapture(str(video_path))
    try:
        cap.set(cv2.CAP_PROP_POS_MSEC, max(0.0, t) * 1000)
        ok, frame = cap.read()
        if not ok:
            cap.set(cv2.CAP_PROP_POS_MSEC, 0)
            ok, frame = cap.read()
        if not ok:
            return None
        return Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    finally:
        cap.release()


def box_at(boxes: list[dict], t: float) -> dict | None:
    if not boxes:
        return None
    return min(boxes, key=lambda b: abs(b["t"] - t))


def crop_pct(img: Image.Image, box: dict, pad: float = 0.1, square: bool = False) -> Image.Image:
    W, H = img.size
    x, y, w, h = box["x"] / 100 * W, box["y"] / 100 * H, box["w"] / 100 * W, box["h"] / 100 * H
    if square:
        side = max(w, h)
        x, y, w, h = x + w / 2 - side / 2, y + h / 2 - side / 2, side, side
    px, py = w * pad, h * pad
    l, t, r, b = max(0, x - px), max(0, y - py), min(W, x + w + px), min(H, y + h + py)
    if r - l < 2 or b - t < 2:
        return img.copy()
    return img.crop((int(l), int(t), int(r), int(b)))


def save_jpeg(img: Image.Image, dst: Path, min_side: int = 0) -> str:
    if min_side and min(img.size) < min_side:
        s = min_side / max(1, min(img.size))
        img = img.resize((max(1, int(img.width * s)), max(1, int(img.height * s))), Image.LANCZOS)
    dst.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").save(dst, "JPEG", quality=88)
    return media.rel(dst)


def find_face(img: Image.Image) -> Image.Image:
    """Crop the largest face if a classic Haar detector finds one; otherwise use the whole image."""
    global _CASCADE
    if _CASCADE is None:
        _CASCADE = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    arr = cv2.cvtColor(np.asarray(img.convert("RGB")), cv2.COLOR_RGB2GRAY)
    faces = _CASCADE.detectMultiScale(arr, scaleFactor=1.1, minNeighbors=5, minSize=(40, 40)) if not _CASCADE.empty() else []
    if len(faces) == 0:
        return img
    x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
    m = int(0.15 * w)
    return img.crop((max(0, x - m), max(0, y - m), min(img.width, x + w + m), min(img.height, y + h + m)))


def face_embedding_from_upload(img: Image.Image) -> list[float]:
    return embed(find_face(img))
