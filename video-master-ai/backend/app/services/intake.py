"""Evidence intake (WF-02, WF-04): verify hashes, assign EV code, lock the original, queue analysis."""

import shutil
from datetime import timedelta
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..domain import SOURCE_LABEL, analysis_label
from ..models import AnalysisJob, Camera, Case, Integrity, JobKind, User, Video, VideoState
from ..security import sha256_file
from . import media
from .audit import audit
from .events import publish


def ensure_camera(db: Session, cam_id: str) -> Camera:
    cam = db.get(Camera, cam_id)
    if not cam:
        cam = Camera(id=cam_id, name="")
        db.add(cam)
        db.flush()
    return cam


def next_evidence_id(case: Case) -> str:
    case.ev_seq += 1
    num = case.code.split("-", 1)[1]
    return f"EV-{num}-{case.ev_seq:02d}"


def demo_truth_for(sha: str) -> str | None:
    p = get_settings().data_dir / "demo" / f"{sha}.json"
    return media.rel(p) if p.exists() else None


def video_event(db: Session, v: Video, kind: str = "video") -> None:
    publish(db, kind, {"video_id": v.id, "case_id": v.case_id, "state": v.state.value, "progress": round(v.progress, 1)})


def finalize_upload(db: Session, v: Video, tmp: Path, client_sha: str, user: User, ip: str = "") -> tuple[bool, str]:
    """Called once all bytes are in. Returns (accepted, server_sha)."""
    case = db.get(Case, v.case_id)
    v.state = VideoState.HASHING
    video_event(db, v)
    db.commit()

    server_sha = sha256_file(tmp)
    if client_sha.lower() != server_sha:
        v.state = VideoState.REJECTED
        v.sha256_client, v.sha256 = client_sha.lower(), server_sha
        v.error = "hash_mismatch"
        audit(db, "EVIDENCE_REJECT", f"{v.original_file_name} client {client_sha[:8]}… ≠ server {server_sha[:8]}…", case_id=case.id, ip=ip)
        video_event(db, v)
        db.commit()
        tmp.unlink(missing_ok=True)
        return False, server_sha

    ext = Path(v.original_file_name).suffix or ".mp4"
    dst = media.evidence_path(case.code, v.id, ext)
    shutil.move(str(tmp), dst)
    media.lock_readonly(dst)
    meta = media.probe(dst)

    v.storage_path = media.rel(dst)
    v.sha256 = v.sha256_client = server_sha
    v.integrity = Integrity.OK
    v.verified_at = v.acquired_at
    v.size_bytes = dst.stat().st_size
    if meta:
        v.duration_sec = round(meta["duration"], 2) or v.duration_sec
        v.native_fps, v.width, v.height = meta["fps"], meta["width"], meta["height"]
    cam = ensure_camera(db, v.camera_id)
    start = (meta or {}).get("created") or (v.acquired_at - timedelta(seconds=v.duration_sec))
    v.recorded_start = start + timedelta(seconds=cam.clock_offset_sec or 0)
    thumb = media.derived_path("thumbs", f"{v.id}.jpg")
    if media.frame_at(dst, min(1.0, v.duration_sec / 2), thumb, width=480):
        v.thumb_path = media.rel(thumb)
    v.demo_truth = demo_truth_for(server_sha)
    v.evidence_id = next_evidence_id(case)
    v.state = VideoState.QUEUED
    v.analysis_version = 0
    source_vi = SOURCE_LABEL[v.source.value][0]
    audit(db, "EVIDENCE_INGEST", f"{v.evidence_id} {v.original_file_name} ({source_vi})", user=user, case_id=case.id, ip=ip,
          details={"source": v.source.value, "size": v.size_bytes, "camera": v.camera_id})
    audit(db, "EVIDENCE_HASH", f"{v.evidence_id} {server_sha[:8]}…{server_sha[-6:]}", case_id=case.id, details={"sha256": server_sha, "client_match": True})
    queue_analysis(db, v, v.analysis_fps, v.analysis_modes, user, first=True)
    db.commit()
    return True, server_sha


def queue_analysis(db: Session, v: Video, fps: str, modes: dict, user: User | None, first: bool = False) -> AnalysisJob:
    v.analysis_fps, v.analysis_modes = fps, modes
    v.state, v.progress, v.error = VideoState.QUEUED, 0, None
    v.alerts_count = 0
    job = AnalysisJob(video_id=v.id, kind=JobKind.ANALYZE, fps=fps, modes=modes, version=v.analysis_version + 1, requested_by=user.id if user else None)
    db.add(job)
    if not first:
        audit(db, "ANALYSIS_REQUEUE", f"{v.evidence_id} · {analysis_label(fps, modes)}", user=user, case_id=v.case_id)
    audit(db, "ANALYSIS_QUEUE", f"{v.evidence_id} · {analysis_label(fps, modes)}", case_id=v.case_id, details={"fps": fps, "modes": modes})
    video_event(db, v)
    return job


def pending_jobs(db: Session, video_id: str) -> list[AnalysisJob]:
    from ..models import JobStatus

    return list(db.execute(select(AnalysisJob).where(AnalysisJob.video_id == video_id, AnalysisJob.status.in_([JobStatus.QUEUED, JobStatus.RUNNING]))).scalars())
