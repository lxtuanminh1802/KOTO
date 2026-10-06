"""Video evidence: list, detections, rename, remove, re-analyse, cut clips (WF-05), snapshots, enhanced export."""

from pathlib import Path

from fastapi import APIRouter, Depends, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..domain import FPS_OPTIONS, mode_count, normalize_modes
from ..models import AnalysisJob, Detection, JobKind, Snapshot, User, Video, VideoState, Zone, utcnow
from ..security import sha256_file
from ..serializers import detection_out, user_settings, video_out
from ..services import media
from ..services.annotate import annotations_at, snapshot_score
from ..services.audit import audit
from ..services.intake import pending_jobs, queue_analysis, video_event
from ..services.queries import live_videos, videos_out
from ..services.vision import grab, save_jpeg
from .deps import ApiError, client_ip, current_user, get_case, get_video, require

router = APIRouter(prefix="/api/videos", tags=["videos"])


def fmt(sec: float) -> str:
    s = max(0, int(sec))
    return f"{s // 60:02d}:{s % 60:02d}"


class RenameIn(BaseModel):
    name: str


class ReanalyzeIn(BaseModel):
    fps: str = "5"
    modes: dict | None = None


class ClipIn(BaseModel):
    start: float
    end: float


class AtIn(BaseModel):
    t: float


class EnhanceIn(BaseModel):
    denoise: bool = True
    lowlight: bool = True
    stab: bool = False
    super: bool = False
    deblur: bool = False


@router.get("")
def list_videos(user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "case.meta")
    return videos_out(db, live_videos(db), user_settings(user)["min_conf"])


@router.get("/{video_id}")
def one(video_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    v = get_video(db, video_id)
    require(user, "case.meta", get_case(db, v.case_id))
    return videos_out(db, [v], user_settings(user)["min_conf"])[0]


def visible_detections(db: Session, v: Video, min_conf: float) -> list[Detection]:
    if v.state == VideoState.ANALYZED:
        rows = db.execute(select(Detection).where(Detection.video_id == v.id, Detection.analysis_version == v.analysis_version, Detection.confidence >= min_conf)).scalars()
        return sorted(rows, key=lambda d: d.t_in)
    # Still analysing: show only subjects that already raised an early alert (UR-ANA-01, UR-WATCH-04).
    rows = db.execute(select(Detection).where(Detection.video_id == v.id, Detection.analysis_version > v.analysis_version, Detection.alerted.is_(True))).scalars()
    return sorted(rows, key=lambda d: d.t_in)


@router.get("/{video_id}/detections")
def detections(video_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    v = get_video(db, video_id)
    require(user, "video.view", get_case(db, v.case_id))
    dets = visible_detections(db, v, user_settings(user)["min_conf"])
    zones = db.execute(select(Zone).where(Zone.video_id == v.id, Zone.deleted_at.is_(None))).scalars()
    return {"detections": [detection_out(d) for d in dets], "zones": [{"id": z.id, "name": z.name, "polygon": z.polygon} for z in zones]}


@router.patch("/{video_id}")
def rename(video_id: str, body: RenameIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    v = get_video(db, video_id)
    require(user, "video.edit", get_case(db, v.case_id))
    name = body.name.strip()
    if not name:
        raise ApiError(422, "video.name_empty", "Tên video không được để trống.", "The name cannot be empty.")
    if name != v.display_name:
        audit(db, "VIDEO_RENAME", f"{v.evidence_id or ''} {v.display_name} → {name}", user=user, case_id=v.case_id, ip=client_ip(request))
        v.display_name = name[:255]
        video_event(db, v)
    db.commit()
    return video_out(v)


@router.delete("/{video_id}")
def remove(video_id: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """UR-EVD-10 / UR-CLIP-05: soft delete. Removing an original removes its clips too."""
    v = get_video(db, video_id)
    case = get_case(db, v.case_id)
    require(user, "evidence.remove", case)
    gone = [v]
    if not v.parent_id:
        gone += list(db.execute(select(Video).where(Video.parent_id == v.id, Video.deleted_at.is_(None))).scalars())
    for x in gone:
        x.deleted_at, x.state = utcnow(), VideoState.REMOVED
        video_event(db, x)
    label = v.evidence_id or v.display_name
    if len(gone) > 1:
        label += f" (+{len(gone) - 1} đoạn cắt)"
    audit(db, "EVIDENCE_REMOVE", label, user=user, case_id=case.id, ip=client_ip(request), details={"videos": [x.id for x in gone]})
    db.commit()
    return {"removed": [x.id for x in gone]}


@router.post("/{video_id}/reanalyze")
def reanalyze(video_id: str, body: ReanalyzeIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    v = get_video(db, video_id)
    case = get_case(db, v.case_id)
    require(user, "video.upload", case)
    if v.parent_id:
        raise ApiError(422, "video.clip", "Đoạn cắt thừa hưởng kết quả của video gốc; hãy phân tích lại video gốc.", "Clips inherit the original's results; re-analyse the original.")
    if pending_jobs(db, v.id) or v.state in (VideoState.UPLOADING, VideoState.HASHING):
        raise ApiError(409, "video.busy", "Video đang được xử lý.", "The video is still being processed.")
    modes = normalize_modes(body.modes)
    if not mode_count(modes) or body.fps not in FPS_OPTIONS:
        raise ApiError(422, "upload.modes", "Chọn ít nhất một chế độ phân tích.", "Choose at least one analysis mode.")
    queue_analysis(db, v, body.fps, modes, user)
    db.commit()
    return video_out(v)


@router.post("/{video_id}/clips")
async def create_clip(video_id: str, body: ClipIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    cur = get_video(db, video_id)
    case = get_case(db, cur.case_id)
    require(user, "video.edit", case)
    root = db.get(Video, cur.parent_id) if cur.parent_id else cur
    off = (cur.clip_start or 0.0) if cur.parent_id else 0.0
    a, b = round(body.start + off, 1), round(body.end + off, 1)  # UR-CLIP-03: map onto the original's timeline
    if b - a < 1:
        raise ApiError(422, "clip.too_short", "Đoạn cắt phải dài ít nhất 1 giây", "A clip must be at least 1 second long")
    if a < 0 or b > root.duration_sec + 0.5:
        raise ApiError(422, "clip.range", "Khoảng cắt nằm ngoài video.", "The range is outside the video.")
    if not root.storage_path:
        raise ApiError(409, "clip.no_file", "Video gốc chưa có tệp.", "The original has no file yet.")
    root.cut_seq += 1  # never reused, even after a clip is deleted
    n = root.cut_seq
    stem, ext = Path(root.display_name).stem, Path(root.original_file_name).suffix or ".mp4"
    clip = Video(case_id=root.case_id, parent_id=root.id, display_name=f"{stem}_Cut_{n}{ext}", original_file_name=f"{Path(root.original_file_name).stem}_Cut_{n}{ext}",
                 camera_id=root.camera_id, source=root.source, acquired_by=user.id, acquired_at=utcnow(), analysis_fps=root.analysis_fps,
                 analysis_modes=root.analysis_modes, analysis_version=1, analysis_engine=root.analysis_engine, clip_start=a, clip_end=b,
                 duration_sec=round(b - a, 2), width=root.width, height=root.height, native_fps=root.native_fps, state=VideoState.ANALYZED, progress=100,
                 evidence_id=f"{root.evidence_id}-C{n}", thumb_path=root.thumb_path, integrity=root.integrity)
    from datetime import timedelta

    clip.recorded_start = root.recorded_start + timedelta(seconds=a)
    db.add(clip)
    db.flush()
    dst = media.derived_path("clips", root.case_id, f"{clip.id}{ext.lower()}")
    ok = await run_in_threadpool(media.cut, media.absolute(root.storage_path), a, b, dst)
    if not ok:
        db.rollback()
        raise ApiError(500, "clip.ffmpeg", "Không cắt được tệp video.", "Could not cut the video file.")
    clip.storage_path = media.rel(dst)
    clip.size_bytes = dst.stat().st_size
    clip.sha256 = await run_in_threadpool(sha256_file, dst)
    media.lock_readonly(dst)
    thumb = media.derived_path("thumbs", f"{clip.id}.jpg")
    if await run_in_threadpool(media.frame_at, media.absolute(root.storage_path), a + min(1.0, (b - a) / 2), thumb, 480):
        clip.thumb_path = media.rel(thumb)
    # Copy detections inside the range, shifted so the clip starts at 0 (WF-05).
    src_dets = db.execute(select(Detection).where(Detection.video_id == root.id, Detection.analysis_version == root.analysis_version)).scalars()
    for d in src_dets:
        if d.t_out < a or d.t_in > b:
            continue
        boxes = [{**bx, "t": round(bx["t"] - a, 3)} for bx in d.boxes if a <= bx["t"] <= b]
        if not boxes:
            continue
        db.add(Detection(video_id=clip.id, analysis_version=1, track_id=d.track_id, kind=d.kind, t_in=max(0.0, d.t_in - a), t_out=min(b, d.t_out) - a,
                         boxes=boxes, attributes=d.attributes, plate_text=d.plate_text, plate_norm=d.plate_norm, plate_confidence=d.plate_confidence,
                         plate_alternatives=d.plate_alternatives, face_embedding=d.face_embedding, confidence=d.confidence, path=d.path, reid_key=d.reid_key,
                         watch_item_id=d.watch_item_id, alerted=d.alerted, source_detection_id=d.id, crop_path=d.crop_path, face_path=d.face_path))
    audit(db, "CLIP_CREATE", f"{clip.evidence_id} {clip.display_name} ({fmt(a)}–{fmt(b)} của {root.evidence_id})", user=user, case_id=case.id, ip=client_ip(request),
          details={"clip": clip.id, "parent": root.id, "start": a, "end": b, "sha256": clip.sha256})
    video_event(db, clip)
    db.commit()
    return video_out(clip)


@router.post("/{video_id}/snapshot")
async def snapshot(video_id: str, body: AtIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    v = get_video(db, video_id)
    case = get_case(db, v.case_id)
    require(user, "video.edit", case)
    root = db.get(Video, v.parent_id) if v.parent_id else v
    t = max(0.0, min(body.t, v.duration_sec))
    img = await run_in_threadpool(grab, media.absolute(root.storage_path), t + (v.clip_start or 0))
    if img is None:
        raise ApiError(500, "snapshot.failed", "Không trích được khung hình.", "Could not extract the frame.")
    snap = Snapshot(case_id=v.case_id, video_id=v.id, t=t, image_path="", created_by=user.id)
    db.add(snap)
    db.flush()
    snap.image_path = save_jpeg(img, media.derived_path("snapshots", v.case_id, f"{snap.id}.jpg"))
    snap.sha256 = sha256_file(media.absolute(snap.image_path))
    dets = visible_detections(db, v, 0)
    snap.annotations = annotations_at(dets, t)
    snap.counts, snap.score = snapshot_score(snap.annotations)
    audit(db, "SNAPSHOT", f"{v.evidence_id} @ {fmt(t)}", user=user, case_id=case.id, ip=client_ip(request), details={"snapshot": snap.id})
    db.commit()
    from .images import snapshot_out

    return snapshot_out(db, snap)


@router.post("/{video_id}/enhance")
def enhance(video_id: str, body: EnhanceIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    v = get_video(db, video_id)
    require(user, "video.edit", get_case(db, v.case_id))
    job = AnalysisJob(video_id=v.id, kind=JobKind.ENHANCE, options=body.model_dump(), requested_by=user.id)
    db.add(job)
    db.commit()
    return {"job_id": job.id}


@router.get("/{video_id}/jobs")
def jobs(video_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    v = get_video(db, video_id)
    require(user, "video.view", get_case(db, v.case_id))
    rows = db.execute(select(AnalysisJob).where(AnalysisJob.video_id == v.id).order_by(AnalysisJob.created_at.desc()).limit(20)).scalars()
    return [{"id": j.id, "kind": j.kind.value, "status": j.status.value, "progress": j.progress, "version": j.version, "fps": j.fps, "engine": j.engine,
             "result": j.result_path is not None, "error": j.error} for j in rows]

