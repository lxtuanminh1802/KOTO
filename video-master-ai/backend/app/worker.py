"""Analysis worker. Run one or more: `python -m app.worker`. Workers claim jobs with SKIP LOCKED, so they scale out (NFR-SCL-01)."""

import logging
import os
import socket
import threading
import time
from datetime import timedelta

from sqlalchemy import select

from .config import get_settings
from .db import SessionLocal, init_db
from .models import AnalysisJob, JobKind, JobStatus, Video, VideoState, utcnow
from .services.analysis import run_job
from .services.audit import audit, verify_chain
from .services.integrity import verify_all

log = logging.getLogger("vma.worker")


def claim(worker_id: str) -> str | None:
    with SessionLocal() as db:
        job = db.execute(
            select(AnalysisJob).where(AnalysisJob.status == JobStatus.QUEUED).order_by(AnalysisJob.created_at).limit(1).with_for_update(skip_locked=True)
        ).scalar_one_or_none()
        if not job:
            db.rollback()
            return None
        if job.kind == JobKind.ANALYZE:
            v = db.get(Video, job.video_id)
            # Skip superseded jobs (a newer re-analysis was queued for the same video).
            newer = db.execute(select(AnalysisJob.id).where(AnalysisJob.video_id == job.video_id, AnalysisJob.kind == JobKind.ANALYZE,
                                                            AnalysisJob.version > job.version)).first()
            if newer or v is None or v.deleted_at:
                job.status, job.error, job.finished_at = JobStatus.FAILED, "superseded", utcnow()
                db.commit()
                return None
        job.status, job.started_at, job.worker_id = JobStatus.RUNNING, utcnow(), worker_id
        db.commit()
        return job.id


def recover_stale() -> None:
    with SessionLocal() as db:
        cutoff = utcnow() - timedelta(hours=6)
        for job in db.execute(select(AnalysisJob).where(AnalysisJob.status == JobStatus.RUNNING, AnalysisJob.started_at < cutoff)).scalars():
            job.status = JobStatus.QUEUED
            v = db.get(Video, job.video_id)
            if v and v.state == VideoState.ANALYZING:
                v.state, v.progress = VideoState.QUEUED, 0
        db.commit()


def periodic(stop: threading.Event) -> None:
    s = get_settings()
    next_integrity = time.monotonic() + 60
    next_chain = time.monotonic() + 30
    while not stop.wait(30):
        now = time.monotonic()
        try:
            if now >= next_chain:
                next_chain = now + s.audit_check_hours * 3600
                with SessionLocal() as db:
                    ok, bad, n = verify_chain(db)
                    audit(db, "AUDIT_CHAIN_OK" if ok else "AUDIT_CHAIN_BROKEN", f"{n} bản ghi" + ("" if ok else f", hỏng tại #{bad}"), details={"rows": n, "bad_seq": bad})
                    db.commit()
            if now >= next_integrity:
                next_integrity = now + s.integrity_check_hours * 3600
                with SessionLocal() as db:
                    total, bad = verify_all(db)
                    log.info("integrity check: %s originals, %s mismatched", total, bad)
        except Exception:
            log.exception("periodic task failed")


def _loop(worker_id: str, stop: threading.Event) -> None:
    s = get_settings()
    while not stop.is_set():
        try:
            job_id = claim(worker_id)
        except Exception:
            log.exception("claim failed")
            job_id = None
        if not job_id:
            stop.wait(s.worker_poll_seconds)
            continue
        log.info("%s running job %s", worker_id, job_id)
        try:
            run_job(job_id)
        except Exception:
            log.exception("job %s crashed", job_id)


def run_forever(name: str = "") -> None:
    s = get_settings()
    base = name or f"{socket.gethostname()}:{os.getpid()}"
    stop = threading.Event()
    recover_stale()
    threads = [threading.Thread(target=_loop, args=(f"{base}#{i}", stop), daemon=True) for i in range(max(1, s.worker_concurrency))]
    threads.append(threading.Thread(target=periodic, args=(stop,), daemon=True))
    for t in threads:
        t.start()
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        stop.set()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    init_db()
    run_forever()
