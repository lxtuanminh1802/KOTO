"""Annotations for a still frame: person/face/vehicle/plate boxes at time t (UR-VID-06, UR-IMG-01/02)."""

from ..models import Detection, DetKind
from .vision import box_at


def face_rect(b: dict) -> dict:
    return {"x": b["x"] + b["w"] * 13 / 40, "y": b["y"] + b["h"] * 3 / 100, "w": b["w"] * 14 / 40, "h": b["h"] * 14 / 100}


def plate_rect(b: dict) -> dict:
    return {"x": b["x"] + b["w"] * 56 / 160, "y": b["y"] + b["h"] * 61 / 90, "w": b["w"] * 48 / 160, "h": b["h"] * 16 / 90}


def annotations_at(dets: list[Detection], t: float, min_conf: float = 0) -> list[dict]:
    out = []
    for d in dets:
        if not (d.t_in - 0.01 <= t <= d.t_out + 0.01) or d.confidence < min_conf:
            continue
        b = box_at(d.boxes, t)
        if not b:
            continue
        base = {"id": d.id, "track_id": d.track_id, "x": b["x"], "y": b["y"], "w": b["w"], "h": b["h"]}
        if d.kind == DetKind.PERSON:
            out.append({**base, "type": "person", "c": round(d.confidence)})
            if d.face_embedding and not (d.attributes or {}).get("mask"):
                out.append({**base, **face_rect(b), "type": "face", "c": round(d.confidence) - 6})
        else:
            out.append({**base, "type": "vehicle", "c": round(d.confidence)})
            if d.plate_text:
                out.append({**base, **plate_rect(b), "type": "plate", "c": round(d.plate_confidence or 0), "plate": d.plate_text, "alts": d.plate_alternatives or []})
    return out


def snapshot_score(ann: list[dict], low: int = 70) -> tuple[dict, float]:
    """UR-IMG-01: score = people + 1.5 × vehicles + 2 if a plate reads ≥ 70%."""
    p = sum(1 for a in ann if a["type"] == "person")
    v = sum(1 for a in ann if a["type"] == "vehicle")
    plate_ok = any(a["type"] == "plate" and a["c"] >= low for a in ann)
    return {"p": p, "v": v, "plate_ok": plate_ok, "plates": sum(1 for a in ann if a["type"] == "plate")}, p + 1.5 * v + (2 if plate_ok else 0)
