"""Watchlist matching (UR-WATCH-03/04): early alerts during analysis, and silent re-tagging when the list changes."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..domain import plate_match
from ..engine.features import similarity
from ..models import Case, Detection, DetKind, Video, WatchHit, WatchItem, WatchKind
from .audit import audit
from .events import notify, publish, watch_recipients


class Matcher:
    def __init__(self, db: Session) -> None:
        items = db.execute(select(WatchItem).where(WatchItem.deleted_at.is_(None))).scalars().all()
        self.plates = [w for w in items if w.kind == WatchKind.PLATE]
        self.faces = [w for w in items if w.kind == WatchKind.FACE]
        self.face_threshold = get_settings().face_alert_threshold

    def match(self, d: Detection, modes: dict | None = None) -> tuple[WatchItem, float, str] | None:
        modes = modes or {}
        if d.kind == DetKind.VEHICLE:
            if modes and not modes.get("vehicle", {}).get("plate"):
                return None
            for w in self.plates:
                if plate_match(d.plate_text, w.plate_pattern):
                    return w, 100.0, f"Biển số {d.plate_text}"
            return None
        if modes and not modes.get("person", {}).get("face"):
            return None
        if not d.face_embedding or (d.attributes or {}).get("mask"):
            return None
        best = None
        for w in self.faces:
            sims = [similarity(d.face_embedding, im.embedding) for im in w.images if im.embedding]
            if not sims:
                continue
            s = max(sims) + (2 if sum(1 for x in sims if x >= self.face_threshold) > 1 else 0)
            if s >= self.face_threshold and (best is None or s > best[1]):
                best = (w, min(99.0, s), f'Khuôn mặt "{w.name}"')
        return best


def fire_alert(db: Session, d: Detection, v: Video, hit: tuple[WatchItem, float, str]) -> None:
    w, sim, label = hit
    exists = db.execute(select(WatchHit).where(WatchHit.detection_id == d.id, WatchHit.watch_item_id == w.id)).first()
    if exists:
        return
    db.add(WatchHit(detection_id=d.id, watch_item_id=w.id, similarity=sim, alerted=True))
    d.watch_item_id, d.alerted = w.id, True
    v.alerts_count += 1
    case = db.get(Case, v.case_id)
    mm, ss = divmod(int(d.t_in), 60)
    where = f"{v.evidence_id} · {mm:02d}:{ss:02d}"
    audit(db, "WATCH_ALERT", f"{label} · {where} · {sim:.0f}%", case_id=case.id, details={"detection": d.id, "watch_item": w.id})
    label_en = label.replace("Biển số", "Plate").replace("Khuôn mặt", "Face")
    recipients = watch_recipients(db, case, v.acquired_by)
    notify(db, recipients, kind="watch", tone="danger", title=(f"Khớp danh sách theo dõi: {label}", f"Watchlist match: {label_en}"),
           body=(f"{where} · {sim:.0f}% · phát hiện khi đang phân tích", f"{where} · {sim:.0f}% · found during analysis"),
           link={"alert": d.id, "video": v.id, "t": d.t_in, "label_vi": label, "label_en": label_en, "sim": sim, "ev": v.evidence_id, "note": w.note})
    payload = {"detection_id": d.id, "video_id": v.id, "case_id": v.case_id, "label_vi": label, "label_en": label_en, "similarity": sim,
               "evidence_id": v.evidence_id, "t": d.t_in, "note": w.note, "kind": d.kind.value.lower()}
    for uid in recipients:
        publish(db, "watch_alert", payload, user_id=uid)


def retag_all(db: Session) -> int:
    """After the list changes: tag existing results without firing alerts (UR-WATCH-03 last rule)."""
    m = Matcher(db)
    n = 0
    for d in db.execute(select(Detection)).scalars():
        hit = m.match(d)
        new = hit[0].id if hit else None
        if d.watch_item_id != new:
            d.watch_item_id = new
            n += 1
    return n
