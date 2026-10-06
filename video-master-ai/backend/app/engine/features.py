"""Appearance features for face matching.

This is a lightweight stand-in (normalised grey + colour thumbnail) so search, watchlist and re-ID run end to end
on any machine. Swap `embed()` for a real face model (e.g. ArcFace) on-premise; callers only see vectors.
"""

import math

import numpy as np
from PIL import Image, ImageOps

DIM = 16
VEC_LEN = DIM * DIM + 72


def embed(img: Image.Image) -> list[float]:
    img = ImageOps.exif_transpose(img).convert("RGB")
    w, h = img.size
    side = min(w, h)
    img = img.crop(((w - side) // 2, (h - side) // 2, (w + side) // 2, (h + side) // 2))
    small = np.asarray(img.resize((DIM, DIM), Image.BILINEAR), dtype=np.float32) / 255.0
    grey = small.mean(axis=2)
    grey = (grey - grey.mean()) / (grey.std() + 1e-6)
    color = small.reshape(-1, 3).mean(axis=0)  # skin/hair/background tone
    vec = np.concatenate([grey.ravel() * 0.6, np.repeat(color - 0.5, 24) * 3.0])
    n = float(np.linalg.norm(vec)) or 1.0
    return [round(float(x) / n, 5) for x in vec]


def identity_vector(key: str, jitter: str = "", noise: float = 0.12) -> list[float]:
    """What a real face model would output for one identity: a stable unit vector plus per-sighting jitter.
    Used by the simulated engine so search, watchlist and re-ID behave like they will with a real model."""
    import hashlib

    base = np.random.default_rng(int(hashlib.sha256(key.encode()).hexdigest()[:16], 16)).standard_normal(VEC_LEN)
    base /= np.linalg.norm(base)
    if jitter:
        n = np.random.default_rng(int(hashlib.sha256((key + "|" + jitter).encode()).hexdigest()[:16], 16)).standard_normal(VEC_LEN)
        base = base + n / np.linalg.norm(n) * noise
        base /= np.linalg.norm(base)
    return [round(float(x), 5) for x in base]


def similarity(a: list[float] | None, b: list[float] | None) -> float:
    """Cosine similarity mapped to a 0..100 'percent similar' scale."""
    if not a or not b or len(a) != len(b):
        return 0.0
    cos = float(np.dot(np.asarray(a), np.asarray(b)))
    # Same identity ≈ 0.97 cosine → ≈ 95 %; unrelated faces ≈ 0 → ≈ 0 %. Re-calibrate for a real model.
    pct = 100 / (1 + math.exp(-(cos - 0.8) * 18))
    return round(max(0.0, min(99.0, pct)), 1)
