"""Find subjects (WF-06): scope = ticked videos, three ways to search sharing one filter set and result grid."""

import io
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..domain import plate_match
from ..engine.features import similarity
from ..models import Camera, Detection, DetKind, FaceQuery, Tag, User, Video, VideoState, WatchImage
from ..serializers import detection_out, user_settings
from ..services import media
from ..services.audit import audit
from ..services.nlq import parse
from ..services.queries import current_detections
from ..services.vision import face_embedding_from_upload, save_jpeg
from .deps import ApiError, client_ip, current_user, require

router = APIRouter(prefix="/api/search", tags=["search"])


class ParseIn(BaseModel):
    q: str


class SearchIn(BaseModel):
    mode: str = "person"  # person | gait | face | vehicle | plate
    video_ids: list[str] = []
    filters: dict = {}
    sort: str = "time"
    plate_query: str = ""
    face_query_id: str | None = None
    log: bool = False  # write the audit line only when the user actually submits a plate search


@router.post("/parse")
def parse_query(body: ParseIn, user: User = Depends(current_user)):
    require(user, "search")
    return parse(body.q)


def _parse_dt(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def match_filters(d: Detection, f: dict, start: datetime) -> bool:
    """Within a group: OR. Across groups: AND (UR-SRCH-05)."""
    a = d.attributes or {}
    if d.kind == DetKind.PERSON:
        if f.get("gender") and a.get("gender") not in f["gender"]:
            return False
        if f.get("top") and a.get("top") not in f["top"]:
            return False
        if f.get("bottom") and a.get("bottom") not in f["bottom"]:
            return False
        if f.get("mask"):
            if "mask" not in a:  # mask mode off for this video: the filter does not apply (UR-ANA-02)
                pass
            elif ("yes" if a.get("mask") else "no") not in f["mask"]:
                return False
        if f.get("acc") and not set(a.get("accessories") or []) & set(f["acc"]):
            return False
    if f.get("color"):
        cols = {a.get("top_color"), a.get("bottom_color"), a.get("color")} - {None}
        if not cols & set(f["color"]):
            return False
    lo, hi = _parse_dt(f.get("from")), _parse_dt(f.get("to"))
    if lo and start + timedelta(seconds=d.t_out) < lo:
        return False
    if hi and start + timedelta(seconds=d.t_in) > hi:
        return False
    return True


def scope_videos(db: Session, user: User, ids: list[str]) -> list[Video]:
    if not ids:
        return []
    vids = db.execute(select(Video).where(Video.id.in_(ids), Video.deleted_at.is_(None), Video.state == VideoState.ANALYZED)).scalars().all()
    return list(vids)


def result_items(db: Session, dets: list[Detection], vids: dict[str, Video], extra: dict | None = None) -> list[dict]:
    cams = {c.id: c for c in db.execute(select(Camera)).scalars()}
    tags = {t.detection_id: t.color for t in db.execute(select(Tag).where(Tag.detection_id.in_([d.id for d in dets]))).scalars()} if dets else {}
    out = []
    for d in dets:
        v = vids[d.video_id]
        cam = cams.get(v.camera_id)
        item = detection_out(d) | {
            "evidence_id": v.evidence_id, "video_name": v.display_name, "camera_id": v.camera_id, "camera_name": cam.name if cam else "",
            "is_clip": bool(v.parent_id), "abs_in": (v.recorded_start + timedelta(seconds=d.t_in)).isoformat() + "Z",
            "abs_out": (v.recorded_start + timedelta(seconds=d.t_out)).isoformat() + "Z", "tag_color": tags.get(d.id),
        }
        if extra and d.id in extra:
            item |= extra[d.id]
        out.append(item)
    return out


@router.post("")
def search(body: SearchIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "search.face" if body.mode == "face" and body.face_query_id else "search")
    min_conf = user_settings(user)["min_conf"]
    vids = {v.id: v for v in scope_videos(db, user, body.video_ids)}
    kind = DetKind.VEHICLE if body.mode in ("vehicle", "plate") else DetKind.PERSON
    dets = current_detections(db, list(vids), min_conf, kind)
    if body.mode == "face":
        dets = [d for d in dets if d.face_embedding and not (d.attributes or {}).get("mask")]
    dets = [d for d in dets if match_filters(d, body.filters or {}, vids[d.video_id].recorded_start)]
    extra: dict[str, dict] = {}
    if body.mode == "plate" and body.plate_query.strip():
        dets = [d for d in dets if plate_match(d.plate_text, body.plate_query)]
        if body.log:
            audit(db, "SEARCH_PLATE", body.plate_query.strip().upper(), user=user, ip=client_ip(request), details={"videos": len(vids), "results": len(dets)})
            db.commit()
    if body.mode == "face" and body.face_query_id:
        fq = db.get(FaceQuery, body.face_query_id)
        if not fq or fq.user_id != user.id:
            raise ApiError(404, "face.query", "Không tìm thấy truy vấn ảnh.", "Face query not found.")
        threshold = get_settings().face_search_threshold
        kept = []
        for d in dets:
            sims = [similarity(d.face_embedding, im["embedding"]) for im in fq.images]
            best = max(sims) if sims else 0
            qi = sims.index(best) if sims else 0
            if fq.same_person and len(sims) > 1 and sum(1 for s in sims if s >= 80) > 1:
                best = min(99.0, best + 2)  # several angles agree
            if best >= threshold:
                kept.append(d)
                extra[d.id] = {"similarity": round(best), "query_index": None if fq.same_person else qi}
        dets = sorted(kept, key=lambda d: -extra[d.id]["similarity"])
    elif body.sort == "conf":
        dets.sort(key=lambda d: -d.confidence)
    else:
        dets.sort(key=lambda d: vids[d.video_id].recorded_start + timedelta(seconds=d.t_in))
    if body.mode == "plate":  # UR-SRCH-06: plates grouped
        seen, uniq = set(), []
        for d in dets:
            key = d.plate_norm or d.id
            if key not in seen:
                seen.add(key)
                uniq.append(d)
        dets = uniq
    return {"items": result_items(db, dets, vids, extra), "count": len(dets), "videos": len(vids)}


@router.post("/face")
async def face_query(request: Request, same: bool = Form(True), sample_ids: str = Form(""), files: list[UploadFile] = File(default=[]),
                     user: User = Depends(current_user), db: Session = Depends(get_db)):
    """1 to 3 photos: one person at several angles, or several people (UR-SRCH-03)."""
    require(user, "search.face")
    imgs: list[tuple[Image.Image, list[float] | None]] = []
    for f in files[:3]:
        try:
            imgs.append((Image.open(io.BytesIO(await f.read())).convert("RGB"), None))
        except UnidentifiedImageError:
            raise ApiError(422, "face.bad_image", f"'{f.filename}' không phải ảnh.", f"'{f.filename}' is not an image.")
    for sid in [s for s in sample_ids.split(",") if s][: 3 - len(imgs)]:
        im = db.get(WatchImage, sid)
        if im:  # sample photos already carry the model's embedding
            imgs.append((Image.open(media.absolute(im.image_path)).convert("RGB"), im.embedding))
    if not imgs:
        raise ApiError(422, "face.none", "Chọn ít nhất một ảnh khuôn mặt.", "Choose at least one face photo.")
    fq = FaceQuery(user_id=user.id, same_person=same)
    db.add(fq)
    db.flush()
    stored = []
    for i, (im, emb) in enumerate(imgs):
        path = save_jpeg(im, media.derived_path("face_queries", fq.id, f"{i}.jpg"))
        stored.append({"path": path, "embedding": emb or face_embedding_from_upload(im)})
    fq.images = stored
    audit(db, "SEARCH_FACE", f"{len(imgs)} ảnh · {'một đối tượng' if same else 'nhiều đối tượng'}", user=user, ip=client_ip(request),
          details={"query": fq.id, "images": [s["path"] for s in stored], "same_person": same})
    db.commit()
    return {"face_query_id": fq.id, "count": len(imgs)}
