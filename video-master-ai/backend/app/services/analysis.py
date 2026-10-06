"""Analysis job execution (WF-03), re-ID across cameras (UR-ANA-06) and zone hits (WF-07)."""

import logging
import time
from datetime import timedelta
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import SessionLocal
from ..domain import fps_value, plate_norm
from ..engine.base import TrackResult, VideoInfo, get_engine
from ..engine.features import embed
from ..engine.simulated import SimulatedEngine
from ..models import (AnalysisJob, Case, DerivedFile, Detection, DetKind, JobKind, JobStatus, Video, VideoState, WatchItem, WatchKind,
                      Zone, ZoneHit, utcnow)
from . import media
from .audit import audit
from .events import case_recipients, notify, publish
from .intake import video_event
from .vision import box_at, crop_pct, grab, save_jpeg
from .watch import Matcher, fire_alert

log = logging.getLogger("vma.analysis")


class Cancelled(Exception):
    pass


def _engine_for(db: Session, v: Video):
    s = get_settings()
    if s.ai_engine == "opencv" and not v.demo_truth:
        return get_engine("opencv")
    inject = []
    if s.demo_mode and not v.demo_truth:
        plates = db.execute(select(WatchItem).where(WatchItem.kind == WatchKind.PLATE, WatchItem.deleted_at.is_(None))).scalars()
        inject = [w.plate_pattern for w in plates if w.plate_pattern and not any(c in w.plate_pattern for c in "*?")][:1]
    return SimulatedEngine(speed=s.sim_speed, inject_plates=inject)


def _persist_track(db: Session, v: Video, version: int, t: TrackResult) -> Detection:
    src = media.absolute(v.storage_path)
    d = Detection(video_id=v.id, analysis_version=version, track_id=t.track_id, kind=DetKind.PERSON if t.kind == "person" else DetKind.VEHICLE,
                  t_in=t.t_in, t_out=t.t_out, boxes=t.boxes, attributes=t.attributes, confidence=t.confidence,
                  plate_text=t.plate_text, plate_norm=plate_norm(t.plate_text) if t.plate_text else None, plate_confidence=t.plate_confidence,
                  plate_alternatives=t.plate_alternatives, reid_key=t.identity,
                  path=[{"camera_id": v.camera_id, "time": (v.recorded_start + timedelta(seconds=t.t_in)).isoformat() + "Z"}])
    db.add(d)
    db.flush()
    best_t = t.best_t if t.best_t is not None else (t.t_in + t.t_out) / 2
    frame = grab(src, best_t)
    if frame is not None:
        b = box_at(t.boxes, best_t)
        if b:
            d.crop_path = save_jpeg(crop_pct(frame, b, pad=0.12), media.derived_path("detections", v.id, f"{d.id}_crop.jpg"), min_side=200)
        if t.face_box:
            fb = t.face_box
            fframe = frame if abs(fb.get("t", best_t) - best_t) < 0.05 else (grab(src, fb["t"]) or frame)
            face = crop_pct(fframe, fb, pad=0.25, square=True)
            d.face_path = save_jpeg(face, media.derived_path("detections", v.id, f"{d.id}_face.jpg"), min_side=160)
            d.face_embedding = t.face_vector or embed(face)
    return d


def run_analysis(job_id: str) -> None:
    with SessionLocal() as db:
        job = db.get(AnalysisJob, job_id)
        v = db.get(Video, job.video_id)
        if v is None or v.deleted_at or not v.storage_path:
            job.status, job.error, job.finished_at = JobStatus.FAILED, "video missing", utcnow()
            db.commit()
            return
        if get_settings().playback_proxy and not v.proxy_path:
            proxy = media.derived_path("proxy", f"{v.id}.webm")
            if media.make_proxy(media.absolute(v.storage_path), proxy):
                v.proxy_path = media.rel(proxy)
                db.commit()
        engine = _engine_for(db, v)
        job.engine = engine.name
        v.state, v.progress, v.analysis_engine = VideoState.ANALYZING, 0, engine.name
        video_event(db, v)
        db.commit()

        info = VideoInfo(path=media.absolute(v.storage_path), duration=v.duration_sec, width=v.width, height=v.height, native_fps=v.native_fps,
                         truth=media.absolute(v.demo_truth) if v.demo_truth else None, seed=v.sha256 or v.id)
        fps = fps_value(job.fps, v.native_fps)
        matcher = Matcher(db)
        last = {"t": 0.0, "p": 0.0}

        def on_progress(pct: float) -> None:
            now = time.monotonic()
            if pct - last["p"] < 2 and now - last["t"] < 1:
                return
            last.update(t=now, p=pct)
            db.refresh(v, ["deleted_at", "state"])
            if v.deleted_at or v.state == VideoState.REMOVED:
                raise Cancelled()
            v.progress = job.progress = pct
            video_event(db, v, "progress")
            db.commit()

        def on_track(t: TrackResult) -> None:
            d = _persist_track(db, v, job.version, t)
            hit = matcher.match(d, job.modes)
            if hit:
                fire_alert(db, d, v, hit)
            db.commit()

        try:
            engine.analyze(info, fps, job.modes, on_progress, on_track)
        except Cancelled:
            job.status, job.error, job.finished_at = JobStatus.FAILED, "cancelled", utcnow()
            db.commit()
            return
        except Exception as e:  # WF-04: Analyzing → Failed
            log.exception("analysis failed")
            db.rollback()
            v = db.get(Video, job.video_id)
            job = db.get(AnalysisJob, job_id)
            v.state, v.error = VideoState.FAILED, str(e)[:500]
            job.status, job.error, job.finished_at = JobStatus.FAILED, str(e)[:2000], utcnow()
            audit(db, "ANALYSIS_FAIL", f"{v.evidence_id} · {str(e)[:200]}", case_id=v.case_id)
            video_event(db, v)
            db.commit()
            return

        finish_analysis(db, v, job)


def finish_analysis(db: Session, v: Video, job: AnalysisJob) -> None:
    v.analysis_version = job.version
    v.state, v.progress = VideoState.ANALYZED, 100
    job.status, job.progress, job.finished_at = JobStatus.DONE, 100, utcnow()
    db.flush()
    reid_case(db, v.case_id)
    for z in db.execute(select(Zone).where(Zone.video_id == v.id, Zone.deleted_at.is_(None))).scalars():
        compute_zone(db, z)
    n = db.query(Detection).filter(Detection.video_id == v.id, Detection.analysis_version == v.analysis_version).count()
    audit(db, "ANALYSIS_DONE", f"{v.evidence_id} · {n} đối tượng", case_id=v.case_id, details={"objects": n, "engine": job.engine, "version": job.version})
    case = db.get(Case, v.case_id)
    notify(db, case_recipients(db, case, {v.acquired_by}), kind="analysis_done", tone="ok",
           title=(f"{v.display_name} đã phân tích xong", f"{v.display_name} analysis complete"),
           body=(f"{n} đối tượng được nhận diện", f"{n} subjects detected"), link={"video": v.id})
    video_event(db, v)
    db.commit()


def reid_case(db: Session, case_id: str) -> None:
    """Join tracks across cameras inside one case (Q09: no cross-case linking). Vehicles by plate, people by appearance key."""
    roots = db.execute(select(Video).where(Video.case_id == case_id, Video.parent_id.is_(None), Video.deleted_at.is_(None),
                                           Video.state == VideoState.ANALYZED)).scalars().all()
    vids = {v.id: v for v in roots}
    dets = [d for d in db.execute(select(Detection).where(Detection.video_id.in_(list(vids)))).scalars() if d.analysis_version == vids[d.video_id].analysis_version]
    groups: dict[str, list[Detection]] = {}
    for d in dets:
        key = ("plate:" + d.plate_norm) if d.kind == DetKind.VEHICLE and d.plate_norm else (d.reid_key or "track:" + d.id)
        groups.setdefault(key, []).append(d)
    for members in groups.values():
        stamps = sorted(((vids[d.video_id].recorded_start + timedelta(seconds=d.t_in), vids[d.video_id].camera_id) for d in members))
        path, seen = [], set()
        for at, cam in stamps:
            if cam not in seen:
                seen.add(cam)
                path.append({"camera_id": cam, "time": at.isoformat() + "Z"})
        for d in members:
            d.path = path
    # Clips mirror their parent's paths.
    clips = db.execute(select(Video).where(Video.case_id == case_id, Video.parent_id.is_not(None), Video.deleted_at.is_(None))).scalars().all()
    by_id = {d.id: d for d in dets}
    for c in clips:
        for d in db.execute(select(Detection).where(Detection.video_id == c.id)).scalars():
            src = by_id.get(d.source_detection_id or "")
            if src:
                d.path = src.path


def _inside(pt: tuple[float, float], poly: list[list[float]]) -> bool:
    """Ray casting (WF-07)."""
    x, y = pt
    ins = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-9) + xi:
            ins = not ins
        j = i
    return ins


def compute_zone(db: Session, z: Zone) -> int | None:
    v = db.get(Video, z.video_id)
    db.execute(delete(ZoneHit).where(ZoneHit.zone_id == z.id))
    if v.state != VideoState.ANALYZED:
        z.analyzed_version = 0
        return None
    n = 0
    for d in db.execute(select(Detection).where(Detection.video_id == v.id, Detection.analysis_version == v.analysis_version)).scalars():
        if (d.kind == DetKind.PERSON and not z.people) or (d.kind == DetKind.VEHICLE and not z.vehicles):
            continue
        times = [b["t"] for b in d.boxes if _inside((b["x"] + b["w"] / 2, b["y"] + b["h"]), z.polygon)]
        if times:
            db.add(ZoneHit(zone_id=z.id, detection_id=d.id, enter_t=min(times), exit_t=max(times)))
            n += 1
    z.analyzed_version = v.analysis_version
    return n


def run_enhance(job_id: str) -> None:
    """UR-ENH-01 export: derivative video, never replaces the original."""
    with SessionLocal() as db:
        job = db.get(AnalysisJob, job_id)
        v = db.get(Video, job.video_id)
        root = db.get(Video, v.parent_id) if v.parent_id else v
        src = media.absolute(root.storage_path)
        start, end = (v.clip_start, v.clip_end) if v.parent_id else (None, None)
        name = Path(v.display_name).stem + "_AI.mp4"
        dst = media.derived_path("enhanced", v.id, f"{job.id}.mp4")
        job.status, job.started_at = JobStatus.RUNNING, utcnow()
        db.commit()
        ok = media.enhance(src, dst, job.options or {}, start, end)
        from ..security import sha256_file

        if not ok:
            job.status, job.error, job.finished_at = JobStatus.FAILED, "ffmpeg failed", utcnow()
            db.commit()
            return
        sha = sha256_file(dst)
        df = DerivedFile(case_id=v.case_id, kind="enhanced_video", source_video_id=v.id, file_name=name, path=media.rel(dst), sha256=sha,
                         params=job.options or {}, created_by=job.requested_by)
        db.add(df)
        job.status, job.progress, job.finished_at, job.result_path = JobStatus.DONE, 100, utcnow(), media.rel(dst)
        db.flush()
        from ..models import User

        user = db.get(User, job.requested_by) if job.requested_by else None
        audit(db, "VIDEO_ENHANCE", f"{v.evidence_id} → {name} · SHA-256 {sha[:8]}…", user=user, case_id=v.case_id, details={"options": job.options, "derived": df.id})
        if user:
            notify(db, {user.id}, kind="enhance_done", tone="ok", title=(f"Video đã cải thiện sẵn sàng: {name}", f"Enhanced video ready: {name}"),
                   body=("Bản phái sinh, gắn nhãn \"Đã cải thiện bởi AI\"", "Derivative copy labelled \"Enhanced by AI\""), link={"download": f"/api/media/derived/{df.id}"})
        publish(db, "enhance_done", {"video_id": v.id, "derived_id": df.id}, user_id=job.requested_by)
        db.commit()


def run_job(job_id: str) -> None:
    with SessionLocal() as db:
        kind = db.get(AnalysisJob, job_id).kind
    (run_enhance if kind == JobKind.ENHANCE else run_analysis)(job_id)
