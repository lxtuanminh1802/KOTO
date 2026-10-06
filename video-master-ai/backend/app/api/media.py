"""Binary media: video streaming with HTTP Range, thumbnails, crops, snapshots, derived files, reports, packages.

Authenticated with the short `?token=` media token because <video>/<img> cannot send headers.
"""

import mimetypes
import re
from pathlib import Path

from fastapi import APIRouter, Depends, Request
from fastapi.responses import FileResponse, Response, StreamingResponse
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Case, DerivedFile, Detection, ExportPackage, Report, Snapshot, User, Video, WatchImage
from ..services import media
from .deps import ApiError, get_case, get_video, media_user, require

router = APIRouter(prefix="/api/media", tags=["media"])
CHUNK = 1024 * 1024


def _file(relpath: str | None) -> Path:
    p = media.absolute(relpath) if relpath else None
    if not p or not p.exists():
        raise ApiError(404, "media.missing", "Không tìm thấy tệp.", "File not found.")
    return p


def _download(p: Path, name: str) -> FileResponse:
    return FileResponse(p, filename=name, media_type=mimetypes.guess_type(name)[0] or "application/octet-stream")


@router.get("/videos/{video_id}/stream")
def stream(video_id: str, request: Request, user: User = Depends(media_user), db: Session = Depends(get_db)):
    v = get_video(db, video_id)
    require(user, "video.view", get_case(db, v.case_id))
    path = _file(v.storage_path)
    size = path.stat().st_size
    ctype = mimetypes.guess_type(path.name)[0] or "video/mp4"
    rng = request.headers.get("range")
    m = re.match(r"bytes=(\d*)-(\d*)", rng or "")
    if not m:
        return FileResponse(path, media_type=ctype, headers={"Accept-Ranges": "bytes"})
    start = int(m.group(1)) if m.group(1) else max(0, size - int(m.group(2) or 0))
    end = int(m.group(2)) if m.group(1) and m.group(2) else size - 1
    end = min(end, size - 1)
    if start > end:
        return Response(status_code=416, headers={"Content-Range": f"bytes */{size}"})

    def body():
        with open(path, "rb") as f:
            f.seek(start)
            left = end - start + 1
            while left > 0:
                data = f.read(min(CHUNK, left))
                if not data:
                    break
                left -= len(data)
                yield data

    return StreamingResponse(body(), status_code=206, media_type=ctype,
                             headers={"Content-Range": f"bytes {start}-{end}/{size}", "Accept-Ranges": "bytes", "Content-Length": str(end - start + 1)})


@router.get("/videos/{video_id}/thumb")
def thumb(video_id: str, user: User = Depends(media_user), db: Session = Depends(get_db)):
    v = get_video(db, video_id, include_removed=True)
    require(user, "case.meta", get_case(db, v.case_id))
    return FileResponse(_file(v.thumb_path), headers={"Cache-Control": "private, max-age=3600"})


@router.get("/videos/{video_id}/frame")
def frame(video_id: str, t: float = 0, user: User = Depends(media_user), db: Session = Depends(get_db)):
    """A still at time t (seconds on this video's own timeline), cached on disk."""
    v = get_video(db, video_id)
    require(user, "video.view", get_case(db, v.case_id))
    root = db.get(Video, v.parent_id) if v.parent_id else v
    at = max(0.0, min(t, v.duration_sec)) + (v.clip_start or 0)
    dst = media.derived_path("frames", root.id, f"{int(round(at * 10))}.jpg")
    if not dst.exists() and not media.frame_at(_file(root.storage_path), at, dst, width=960):
        raise ApiError(404, "media.missing", "Không trích được khung hình.", "Could not extract the frame.")
    return FileResponse(dst, headers={"Cache-Control": "private, max-age=86400"})


@router.get("/videos/{video_id}/file")
def video_file(video_id: str, user: User = Depends(media_user), db: Session = Depends(get_db)):
    v = get_video(db, video_id)
    require(user, "video.view", get_case(db, v.case_id))
    return _download(_file(v.storage_path), f"{v.evidence_id}_{v.original_file_name}")


@router.get("/detections/{det_id}/{which}")
def det_image(det_id: str, which: str, user: User = Depends(media_user), db: Session = Depends(get_db)):
    d = db.get(Detection, det_id)
    if not d:
        raise ApiError(404, "media.missing", "Không tìm thấy tệp.", "File not found.")
    v = db.get(Video, d.video_id)
    require(user, "video.view", get_case(db, v.case_id))
    return FileResponse(_file(d.face_path if which == "face" else d.crop_path), headers={"Cache-Control": "private, max-age=86400"})


@router.get("/snapshots/{snap_id}")
def snapshot_img(snap_id: str, user: User = Depends(media_user), db: Session = Depends(get_db)):
    s = db.get(Snapshot, snap_id)
    if not s:
        raise ApiError(404, "media.missing", "Không tìm thấy tệp.", "File not found.")
    require(user, "video.view", get_case(db, s.case_id))
    return FileResponse(_file(s.image_path), headers={"Cache-Control": "private, max-age=86400"})


@router.get("/watch/{image_id}")
def watch_img(image_id: str, user: User = Depends(media_user), db: Session = Depends(get_db)):
    im = db.get(WatchImage, image_id)
    if not im:
        raise ApiError(404, "media.missing", "Không tìm thấy tệp.", "File not found.")
    require(user, "search")
    return FileResponse(_file(im.image_path), headers={"Cache-Control": "private, max-age=86400"})


@router.get("/derived/{derived_id}")
def derived(derived_id: str, user: User = Depends(media_user), db: Session = Depends(get_db)):
    df = db.get(DerivedFile, derived_id)
    if not df:
        raise ApiError(404, "media.missing", "Không tìm thấy tệp.", "File not found.")
    require(user, "video.view", get_case(db, df.case_id))
    return _download(_file(df.path), df.file_name)


@router.get("/reports/{report_id}")
def report_file(report_id: str, user: User = Depends(media_user), db: Session = Depends(get_db)):
    r = db.get(Report, report_id)
    if not r:
        raise ApiError(404, "media.missing", "Không tìm thấy tệp.", "File not found.")
    require(user, "report.pdf", db.get(Case, r.case_id))
    return _download(_file(r.path), r.file_name)


@router.get("/packages/{pkg_id}")
def package_file(pkg_id: str, user: User = Depends(media_user), db: Session = Depends(get_db)):
    p = db.get(ExportPackage, pkg_id)
    if not p:
        raise ApiError(404, "media.missing", "Không tìm thấy tệp.", "File not found.")
    require(user, "package", db.get(Case, p.case_id))
    return _download(_file(p.path), p.file_name)
