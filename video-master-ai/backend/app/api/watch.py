"""Watchlist (UR-WATCH-01/02). Scope: whole unit (Q02 pending)."""

import io

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..domain import WATCH_PLATE_RE, plate_norm
from ..models import Detection, DetKind, User, Video, WatchImage, WatchItem, WatchKind, utcnow
from ..serializers import watch_out
from ..services import media
from ..services.audit import audit
from ..services.labels import attrs, label
from ..services.vision import face_embedding_from_upload, save_jpeg
from ..services.watch import retag_all
from .deps import ApiError, client_ip, current_user, require

router = APIRouter(prefix="/api/watch", tags=["watch"])


class PlateIn(BaseModel):
    plate: str
    note: str = ""


class FromDetIn(BaseModel):
    detection_id: str


def _items(db: Session) -> list[WatchItem]:
    return list(db.execute(select(WatchItem).where(WatchItem.deleted_at.is_(None)).order_by(WatchItem.created_at.desc())).scalars())


@router.get("")
def list_watch(user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "search")
    items = _items(db)
    return {"faces": [watch_out(w) for w in items if w.kind == WatchKind.FACE], "plates": [watch_out(w) for w in items if w.kind == WatchKind.PLATE]}


def _check_plate(db: Session, p: str) -> str:
    p = p.strip().upper()
    if not WATCH_PLATE_RE.match(p):
        raise ApiError(422, "watch.plate_format", "Dạng biển số: 30K-456.78, có thể dùng * hoặc ?", "Format: 30K-456.78, * or ? allowed", field="plate")
    if any(plate_norm(w.plate_pattern or "") == plate_norm(p) for w in _items(db) if w.kind == WatchKind.PLATE):
        raise ApiError(422, "watch.plate_dup", "Biển số đã có trong danh sách", "Already on the list", field="plate")
    return p


@router.post("/plates")
def add_plate(body: PlateIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "watch.manage")
    p = _check_plate(db, body.plate)
    w = WatchItem(kind=WatchKind.PLATE, plate_pattern=p, plate_norm=plate_norm(p), note=body.note.strip()[:500], created_by=user.id)
    db.add(w)
    db.flush()
    audit(db, "WATCH_ADD", f"Biển số: {p}", user=user, ip=client_ip(request))
    retag_all(db)
    db.commit()
    return watch_out(w)


@router.post("/faces")
async def add_face(request: Request, name: str = Form(...), note: str = Form(""), files: list[UploadFile] = File(default=[]),
                   user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "watch.manage")
    if not name.strip():
        raise ApiError(422, "watch.name", "Nhập tên đối tượng.", "Enter a name.", field="name")
    imgs = []
    for f in files[:3]:
        try:
            imgs.append(Image.open(io.BytesIO(await f.read())).convert("RGB"))
        except UnidentifiedImageError:
            raise ApiError(422, "watch.bad_image", f"'{f.filename}' không phải ảnh.", f"'{f.filename}' is not an image.")
    if not imgs:
        raise ApiError(422, "watch.no_image", "Thêm ít nhất 1 ảnh.", "Add at least one photo.", field="files")
    w = WatchItem(kind=WatchKind.FACE, name=name.strip()[:255], note=note.strip()[:500], created_by=user.id)
    db.add(w)
    db.flush()
    for i, im in enumerate(imgs):
        path = save_jpeg(im, media.derived_path("watch", w.id, f"{i}.jpg"))
        db.add(WatchImage(watch_item_id=w.id, image_path=path, embedding=face_embedding_from_upload(im)))
    audit(db, "WATCH_ADD", f"Khuôn mặt: {w.name} ({len(imgs)} ảnh)", user=user, ip=client_ip(request))
    db.flush()
    retag_all(db)
    db.commit()
    db.refresh(w)
    return watch_out(w)


def add_from_detection(db: Session, d: Detection, user: User | None) -> WatchItem:
    v = db.get(Video, d.video_id)
    if d.kind == DetKind.VEHICLE:
        if not d.plate_text:
            raise ApiError(422, "watch.no_plate", "Phương tiện chưa đọc được biển số.", "This vehicle has no plate reading.")
        p = _check_plate(db, d.plate_text)
        w = WatchItem(kind=WatchKind.PLATE, plate_pattern=p, plate_norm=plate_norm(p), note=attrs(d), ref_detection_id=d.id, created_by=user.id if user else v.acquired_by)
        db.add(w)
        db.flush()
        audit(db, "WATCH_ADD", f"Biển số: {p}", user=user, case_id=v.case_id)
        return w
    # Person: up to three face crops of the same track or re-ID group (several angles / moments).
    same = [d]
    if d.reid_key:
        same += [x for x in db.execute(select(Detection).where(Detection.reid_key == d.reid_key, Detection.id != d.id)).scalars() if x.face_path][:4]
    faces = [x for x in same if x.face_path][:3]
    if not faces:
        raise ApiError(422, "watch.no_face", "Không có ảnh khuôn mặt rõ (có thể đeo khẩu trang).", "No clear face image (possibly masked).")
    w = WatchItem(kind=WatchKind.FACE, name=f"{label(d)} ({v.evidence_id})", note=attrs(d), ref_detection_id=d.id, created_by=user.id if user else v.acquired_by)
    db.add(w)
    db.flush()
    for i, x in enumerate(faces):
        img = Image.open(media.absolute(x.face_path)).convert("RGB")
        path = save_jpeg(img, media.derived_path("watch", w.id, f"{i}.jpg"))
        db.add(WatchImage(watch_item_id=w.id, image_path=path, embedding=x.face_embedding))
    audit(db, "WATCH_ADD", f"Khuôn mặt: {w.name} ({len(faces)} ảnh)", user=user, case_id=v.case_id)
    return w


@router.post("/from-detection")
def from_detection(body: FromDetIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "watch.manage")
    d = db.get(Detection, body.detection_id)
    if not d:
        raise ApiError(404, "det.not_found", "Không tìm thấy đối tượng.", "Subject not found.")
    w = add_from_detection(db, d, user)
    db.flush()
    retag_all(db)
    db.commit()
    db.refresh(w)
    return watch_out(w)


@router.delete("/{item_id}")
def remove(item_id: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "watch.manage")
    w = db.get(WatchItem, item_id)
    if not w or w.deleted_at:
        raise ApiError(404, "watch.not_found", "Không tìm thấy mục theo dõi.", "Watchlist entry not found.")
    w.deleted_at = utcnow()
    audit(db, "WATCH_REMOVE", w.plate_pattern or w.name, user=user, ip=client_ip(request))
    db.flush()
    retag_all(db)
    db.commit()
    return {"ok": True}
