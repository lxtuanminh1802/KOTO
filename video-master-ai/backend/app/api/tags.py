"""Tags and bookmarks (UR-TAG-01/02)."""

from datetime import timedelta

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..domain import TAG_COLORS
from ..models import Detection, Tag, User, Video
from ..serializers import detection_out, iso, tag_out
from ..services.audit import audit
from ..services.labels import attrs, label, mmss
from .deps import ApiError, client_ip, current_user, get_case, get_video, require
from .videos import visible_detections

router = APIRouter(prefix="/api", tags=["tags"])


class TagIn(BaseModel):
    detection_id: str
    color: str = "red"


class BookmarkIn(BaseModel):
    video_id: str
    t: float


class TagPatch(BaseModel):
    color: str | None = None
    note: str | None = None


def _color(c: str) -> str:
    if c not in TAG_COLORS:
        raise ApiError(422, "tag.color", "Màu thẻ không hợp lệ.", "Invalid tag colour.")
    return c


@router.get("/cases/{case_id}/tags")
def list_tags(case_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    case = get_case(db, case_id)
    require(user, "video.view", case)
    tags = db.execute(select(Tag).where(Tag.case_id == case.id).order_by(Tag.created_at.desc())).scalars().all()
    vids = {v.id: v for v in db.execute(select(Video).where(Video.id.in_([t.video_id for t in tags] or ["-"]))).scalars()}
    dets = {d.id: d for d in db.execute(select(Detection).where(Detection.id.in_([t.detection_id for t in tags if t.detection_id] or ["-"]))).scalars()}
    out = []
    for t in tags:
        v = vids.get(t.video_id)
        if not v or v.deleted_at:
            continue
        d = dets.get(t.detection_id) if t.detection_id else None
        out.append(tag_out(t) | {"evidence_id": v.evidence_id, "video_name": v.display_name, "camera_id": v.camera_id,
                                 "abs_time": iso(v.recorded_start + timedelta(seconds=t.t)), "detection": detection_out(d) if d else None})
    return out


@router.post("/tags")
def tag_subject(body: TagIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    d = db.get(Detection, body.detection_id)
    if not d:
        raise ApiError(404, "det.not_found", "Không tìm thấy đối tượng.", "Subject not found.")
    v = get_video(db, d.video_id)
    case = get_case(db, v.case_id)
    require(user, "tag", case)
    t = db.execute(select(Tag).where(Tag.detection_id == d.id)).scalar_one_or_none()
    if t:  # one tag per subject: re-tagging changes the colour
        t.color = _color(body.color)
    else:
        t = Tag(case_id=case.id, video_id=v.id, detection_id=d.id, t=d.t_in, color=_color(body.color), note=f"{label(d)}, {attrs(d)}"[:500], created_by=user.id)
        db.add(t)
    audit(db, "TAG_SUBJECT", f"{d.track_id} · {v.evidence_id} · {t.color}", user=user, case_id=case.id, ip=client_ip(request))
    db.commit()
    return tag_out(t)


@router.post("/tags/bookmark")
def bookmark(body: BookmarkIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    v = get_video(db, body.video_id)
    case = get_case(db, v.case_id)
    require(user, "tag", case)
    near = next((d for d in visible_detections(db, v, 0) if d.t_in <= body.t <= d.t_out), None)
    note = f"{label(near)}, {mmss(body.t)}" if near else f"Đánh dấu {mmss(body.t)}"
    t = Tag(case_id=case.id, video_id=v.id, detection_id=None, t=round(body.t, 2), color="red", note=note, created_by=user.id)
    db.add(t)
    audit(db, "BOOKMARK", f"{v.evidence_id} @ {mmss(body.t)}", user=user, case_id=case.id, ip=client_ip(request))
    db.commit()
    return tag_out(t)


@router.patch("/tags/{tag_id}")
def patch_tag(tag_id: str, body: TagPatch, user: User = Depends(current_user), db: Session = Depends(get_db)):
    t = db.get(Tag, tag_id)
    if not t:
        raise ApiError(404, "tag.not_found", "Không tìm thấy thẻ.", "Tag not found.")
    require(user, "tag", get_case(db, t.case_id))
    if body.color is not None:
        t.color = _color(body.color)
    if body.note is not None:
        t.note = body.note[:500]
    db.commit()
    return tag_out(t)


@router.delete("/tags/{tag_id}")
def delete_tag(tag_id: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    t = db.get(Tag, tag_id)
    if not t:
        raise ApiError(404, "tag.not_found", "Không tìm thấy thẻ.", "Tag not found.")
    require(user, "tag", get_case(db, t.case_id))
    audit(db, "TAG_DELETE", t.note[:200], user=user, case_id=t.case_id, ip=client_ip(request))
    db.delete(t)
    db.commit()
    return {"ok": True}
