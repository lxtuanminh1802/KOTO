"""UR-EVD-09: re-hash originals (before export and weekly) and alert on any mismatch."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Case, Integrity, Role, User, Video, VideoState, utcnow
from ..security import sha256_file
from . import media
from .audit import audit
from .events import notify, publish


def verify_video(db: Session, v: Video, user: User | None = None) -> bool:
    if not v.storage_path or not v.sha256:
        return True
    path = media.absolute(v.storage_path)
    actual = sha256_file(path) if path.exists() else ""
    v.verified_at = utcnow()
    if actual == v.sha256:
        if v.integrity != Integrity.OK:
            v.integrity = Integrity.OK
        return True
    first_time = v.integrity != Integrity.MISMATCH
    v.integrity = Integrity.MISMATCH
    if first_time:
        audit(db, "EVIDENCE_VERIFY_FAIL", f"{v.evidence_id} lưu trữ {actual[:8] or 'mất tệp'}… ≠ tiếp nhận {v.sha256[:8]}…", user=user, case_id=v.case_id,
              details={"expected": v.sha256, "actual": actual})
        case = db.get(Case, v.case_id)
        admins = {u.id for u in db.execute(select(User).where(User.role == Role.ADMIN)).scalars()}
        notify(db, {case.lead_user_id} | admins, kind="integrity", tone="danger",
               title=(f"Lệch mã băm: {v.evidence_id}", f"Hash mismatch: {v.evidence_id}"),
               body=("Tệp gốc không còn khớp mã băm lúc tiếp nhận. Mọi lần xuất gói của vụ án bị chặn.", "The original no longer matches its intake hash. Exports of this case are blocked."),
               link={"video": v.id})
        publish(db, "video", {"video_id": v.id, "case_id": v.case_id, "state": v.state.value, "progress": v.progress})
    return False


def verify_all(db: Session) -> tuple[int, int]:
    bad = 0
    vids = db.execute(select(Video).where(Video.deleted_at.is_(None), Video.parent_id.is_(None), Video.state.not_in([VideoState.REJECTED, VideoState.REMOVED]))).scalars().all()
    for v in vids:
        if not verify_video(db, v):
            bad += 1
        db.commit()
    return len(vids), bad
