"""Resumable chunked upload (UR-EVD-01..08, NFR-PERF-01).

init → PUT chunks at byte offsets (resume with GET) → complete with the client-side SHA-256.
"""

from pathlib import Path

from fastapi import APIRouter, Depends, Query, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..domain import CAMERA_RE, FPS_OPTIONS, VIDEO_EXTS, mode_count, normalize_modes
from ..models import UploadSession, User, Video, VideoSource, VideoState, utcnow
from ..serializers import video_out
from ..services.intake import ensure_camera, finalize_upload, video_event
from .deps import ApiError, client_ip, current_user, get_case, require

router = APIRouter(prefix="/api/uploads", tags=["uploads"])


class InitIn(BaseModel):
    case_id: str
    file_name: str
    size: int
    camera_id: str = ""
    source: VideoSource = VideoSource.NVR
    fps: str = "5"
    modes: dict | None = None
    duration: float | None = None


class CompleteIn(BaseModel):
    sha256: str


def _session(db: Session, upload_id: str, user: User) -> UploadSession:
    s = db.get(UploadSession, upload_id)
    if not s or s.user_id != user.id:
        raise ApiError(404, "upload.not_found", "Không tìm thấy phiên tải lên.", "Upload not found.")
    return s


@router.post("/init")
def init(body: InitIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = get_settings()
    case = get_case(db, body.case_id)
    require(user, "video.upload", case)
    name = Path(body.file_name).name
    if Path(name).suffix.lower() not in VIDEO_EXTS:
        raise ApiError(422, "upload.format", f"'{name}' không phải file video. Chọn MP4, MOV, AVI hoặc MKV.", f"'{name}' is not a video. Choose MP4, MOV, AVI or MKV.")
    if body.size <= 0 or body.size > s.max_upload_bytes:
        raise ApiError(422, "upload.size", f"'{name}' vượt quá 4 GB.", f"'{name}' is larger than 4 GB.")
    modes = normalize_modes(body.modes)
    if not mode_count(modes):
        raise ApiError(422, "upload.modes", "Chọn ít nhất một chế độ phân tích.", "Choose at least one analysis mode.")
    if body.fps not in FPS_OPTIONS:
        raise ApiError(422, "upload.fps", "Khung hình phân tích không hợp lệ.", "Invalid analysis frame rate.")
    cam = (body.camera_id or "").strip().upper()
    if not cam:
        m = CAMERA_RE.search(name.upper())
        cam = m.group(0) if m else "CAM_UP_01"
    ensure_camera(db, cam[:30])
    v = Video(case_id=case.id, display_name=name, original_file_name=name, size_bytes=body.size, camera_id=cam[:30], source=body.source,
              acquired_by=user.id, acquired_at=utcnow(), analysis_fps=body.fps, analysis_modes=modes, duration_sec=body.duration or 0, state=VideoState.UPLOADING)
    db.add(v)
    db.flush()
    tmp = s.upload_tmp_dir / f"{v.id}.part"
    tmp.touch()
    up = UploadSession(video_id=v.id, user_id=user.id, file_name=name, size_bytes=body.size, tmp_path=str(tmp))
    db.add(up)
    video_event(db, v)
    db.commit()
    return {"upload_id": up.id, "video_id": v.id, "chunk_size": s.upload_chunk_bytes, "received": 0}


@router.get("/{upload_id}")
def status(upload_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    up = _session(db, upload_id, user)
    return {"upload_id": up.id, "video_id": up.video_id, "received": up.received_bytes, "size": up.size_bytes, "status": up.status}


@router.put("/{upload_id}")
async def put_chunk(upload_id: str, request: Request, offset: int = Query(..., ge=0), user: User = Depends(current_user), db: Session = Depends(get_db)):
    up = _session(db, upload_id, user)
    if up.status != "OPEN":
        raise ApiError(409, "upload.closed", "Phiên tải lên đã đóng.", "This upload is closed.")
    if offset > up.received_bytes:
        raise ApiError(409, "upload.gap", "Thiếu dữ liệu, tiếp tục từ vị trí đã nhận.", "Missing data; resume from the received offset.", received=up.received_bytes)
    data = await request.body()
    if offset + len(data) > up.size_bytes:
        raise ApiError(422, "upload.overflow", "Dữ liệu vượt quá kích thước tệp.", "More data than the declared size.")

    def write():
        with open(up.tmp_path, "r+b") as f:
            f.seek(offset)
            f.write(data)

    await run_in_threadpool(write)
    up.received_bytes = max(up.received_bytes, offset + len(data))
    db.commit()
    return {"received": up.received_bytes}


@router.post("/{upload_id}/complete")
async def complete(upload_id: str, body: CompleteIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    up = _session(db, upload_id, user)
    if up.received_bytes != up.size_bytes:
        raise ApiError(409, "upload.incomplete", "Tệp chưa tải lên đủ.", "The file is not fully uploaded.", received=up.received_bytes)
    v = db.get(Video, up.video_id)
    up.status = "DONE"
    db.commit()
    ok, server_sha = await run_in_threadpool(finalize_upload, db, v, Path(up.tmp_path), body.sha256, user, client_ip(request))
    db.refresh(v)
    if not ok:
        raise ApiError(409, "upload.integrity", "Mã băm phía máy chủ không khớp với máy trạm. Tệp bị từ chối, hãy tải lại.",
                       "Server hash does not match the client hash. The file was rejected; upload it again.", server_sha256=server_sha)
    return video_out(v)


@router.delete("/{upload_id}")
def cancel(upload_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    up = _session(db, upload_id, user)
    v = db.get(Video, up.video_id)
    if up.status == "OPEN":
        up.status = "FAILED"
        Path(up.tmp_path).unlink(missing_ok=True)
        v.state, v.error = VideoState.FAILED, "upload_cancelled"
        video_event(db, v)
        db.commit()
    return {"ok": True}
