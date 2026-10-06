"""Cameras, locations and routes (WF-09, UR-MAP-01..04)."""

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Camera, DetKind, User, Video
from ..serializers import camera_out, user_settings
from ..services.analysis import reid_case
from ..services.audit import audit
from ..services.queries import current_detections, live_videos
from .deps import ApiError, client_ip, current_user, get_video, require
from .search import result_items

router = APIRouter(prefix="/api", tags=["map"])


class CameraIn(BaseModel):
    id: str
    name: str = ""
    lat: float
    lng: float
    video_id: str | None = None
    clock_offset_sec: int | None = None


class MoveIn(BaseModel):
    lat: float
    lng: float


def _check(lat: float, lng: float) -> None:
    errs = {}
    if not -90 <= lat <= 90:
        errs["lat"] = {"vi": "Vĩ độ nằm trong khoảng −90 đến 90", "en": "Latitude must be between −90 and 90"}
    if not -180 <= lng <= 180:
        errs["lng"] = {"vi": "Kinh độ nằm trong khoảng −180 đến 180", "en": "Longitude must be between −180 and 180"}
    if errs:
        raise ApiError(422, "validation", "Kiểm tra lại tọa độ.", "Check the coordinates.", fields=errs)


@router.get("/cameras")
def cameras(user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "case.meta")
    vids = live_videos(db)
    out = []
    for c in db.execute(select(Camera).order_by(Camera.id)).scalars():
        out.append(camera_out(c) | {"videos": [{"id": v.id, "evidence_id": v.evidence_id, "name": v.display_name} for v in vids if v.camera_id == c.id and not v.parent_id]})
    return out


@router.post("/cameras")
def upsert(body: CameraIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Existing ID: move it. New ID: create it. Optionally assign a video (and its clips) to it."""
    require(user, "camera")
    cid = body.id.strip().upper()[:30]
    if not cid:
        raise ApiError(422, "validation", "Nhập mã camera", "Enter a camera ID", fields={"id": {"vi": "Nhập mã camera", "en": "Enter a camera ID"}})
    _check(body.lat, body.lng)
    cam = db.get(Camera, cid)
    created = cam is None
    if created:
        cam = Camera(id=cid, name=body.name.strip() or "Camera bổ sung")
        db.add(cam)
    elif body.name.strip():
        cam.name = body.name.strip()
    cam.lat, cam.lng = round(body.lat, 6), round(body.lng, 6)
    if body.clock_offset_sec is not None:
        cam.clock_offset_sec = body.clock_offset_sec
    db.flush()
    if body.video_id:
        v = get_video(db, body.video_id)
        old = v.camera_id
        group = [v] + list(db.execute(select(Video).where(Video.parent_id == v.id)).scalars())
        for x in group:
            x.camera_id = cid
        reid_case(db, v.case_id)
        audit(db, "CAMERA_ASSIGN", f"{v.evidence_id} → {cid} ({cam.lat}, {cam.lng})" + (f", trước đó {old}" if old != cid else ""), user=user, case_id=v.case_id, ip=client_ip(request))
    elif created:
        audit(db, "CAMERA_ADD", f"{cid} ({cam.lat}, {cam.lng})", user=user, ip=client_ip(request))
    else:
        audit(db, "CAMERA_MOVE", f"{cid} → {cam.lat}, {cam.lng}", user=user, ip=client_ip(request))
    db.commit()
    return camera_out(cam)


@router.patch("/cameras/{cam_id}")
def move(cam_id: str, body: MoveIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "camera")
    cam = db.get(Camera, cam_id)
    if not cam:
        raise ApiError(404, "camera.not_found", "Không tìm thấy camera.", "Camera not found.")
    _check(body.lat, body.lng)
    cam.lat, cam.lng = round(body.lat, 6), round(body.lng, 6)
    audit(db, "CAMERA_MOVE", f"{cam.id} → {cam.lat}, {cam.lng}", user=user, ip=client_ip(request))
    db.commit()
    return camera_out(cam)


@router.get("/tracks")
def tracks(kind: str = "gait", case_id: str | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Subjects for the map grid (UR-MAP-04): vehicles, people (gait) or faces, with their camera path."""
    require(user, "video.view")
    min_conf = user_settings(user)["min_conf"]
    roots = {v.id: v for v in live_videos(db, case_id) if not v.parent_id and v.state.value == "ANALYZED"}
    dets = current_detections(db, list(roots), min_conf, DetKind.VEHICLE if kind == "vehicle" else DetKind.PERSON)
    if kind == "face":
        dets = [d for d in dets if d.face_path and not (d.attributes or {}).get("mask")]
    dets.sort(key=lambda d: (-len(d.path or []), roots[d.video_id].recorded_start.timestamp() + d.t_in))
    return result_items(db, dets, roots)
