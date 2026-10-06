"""UR-CASE-01..07 and the overview page (progress, evidence table, priority leads, audit trail)."""

import re

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..domain import CASE_CODE_RE
from ..models import AuditLog, Case, CaseStatus, DetKind, Role, Tag, User, VideoState
from ..serializers import case_out, detection_out, iso, user_out, user_settings
from ..services.audit import audit
from ..services.queries import current_detections, live_videos, videos_out
from .deps import ApiError, client_ip, current_user, get_case, require

router = APIRouter(prefix="/api", tags=["cases"])


class CaseIn(BaseModel):
    code: str
    title: str
    decision_no: str = ""
    lead_user_id: str | None = None


class CasePatch(BaseModel):
    title: str | None = None
    decision_no: str | None = None
    lead_user_id: str | None = None
    status: CaseStatus | None = None


@router.get("/users")
def list_users(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return [user_out(u) for u in db.execute(select(User).where(User.active.is_(True)).order_by(User.full_name)).scalars()]


@router.get("/cases")
def list_cases(user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "case.meta")
    cases = db.execute(select(Case).order_by(Case.opened_at)).scalars().all()
    return [case_out(c) for c in cases]


@router.get("/cases/next-code")
def next_code(user: User = Depends(current_user), db: Session = Depends(get_db)):
    nums = [int(m.group(1)) for (code,) in db.execute(select(Case.code)) if (m := re.match(r"^VA-(\d+)$", code))]
    return {"code": f"VA-{(max(nums) + 1) if nums else 101}"}


def _validate(db: Session, body: CaseIn) -> dict:
    errs = {}
    code = body.code.strip().upper()
    if not CASE_CODE_RE.match(code):
        errs["code"] = ("Dạng mã: VA-125", "Format: VA-125")
    elif db.execute(select(Case).where(Case.code == code)).first():
        errs["code"] = ("Mã này đã tồn tại", "This ID already exists")
    if len(body.title.strip()) < 3:
        errs["title"] = ("Tên vụ án tối thiểu 3 ký tự", "Case name needs at least 3 characters")
    return errs


@router.post("/cases")
def create_case(body: CaseIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "case.create")
    errs = _validate(db, body)
    lead = db.get(User, body.lead_user_id) if body.lead_user_id else user
    if not lead or not lead.active:
        errs["lead_user_id"] = ("Chọn điều tra viên phụ trách", "Choose the lead investigator")
    if errs:
        raise ApiError(422, "validation", "Kiểm tra lại các ô được đánh dấu.", "Check the highlighted fields.", fields={k: {"vi": v[0], "en": v[1]} for k, v in errs.items()})
    code = body.code.strip().upper()
    c = Case(code=code, title=body.title.strip(), decision_no=body.decision_no.strip() or f"{code.split('-')[1]}/QĐ", lead_user_id=lead.id, created_by=user.id)
    db.add(c)
    db.flush()
    audit(db, "CASE_OPEN", code, user=user, case_id=c.id, ip=client_ip(request))
    db.commit()
    db.refresh(c)
    return case_out(c)


@router.patch("/cases/{case_id}")
def update_case(case_id: str, body: CasePatch, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = get_case(db, case_id)
    require(user, "case.edit", c)
    changes = {}
    for field in ("title", "decision_no", "lead_user_id"):
        val = getattr(body, field)
        if val is not None and val != getattr(c, field):
            changes[field] = [getattr(c, field), val]
            setattr(c, field, val.strip() if isinstance(val, str) else val)
    if body.status and body.status != c.status:
        if body.status == CaseStatus.CLOSED:
            require(user, "case.close", c)
        changes["status"] = [c.status.value, body.status.value]
        c.status = body.status
    if changes:
        audit(db, "CASE_UPDATE", c.code + " " + "; ".join(f"{k}: {a} → {b}" for k, (a, b) in changes.items()), user=user, case_id=c.id, ip=client_ip(request), details={"changes": changes})
    db.commit()
    return case_out(c)


def priority_leads(db: Session, case: Case, min_conf: float, video_ids: list[str]) -> list:
    """UR-CASE-05: subjects seen on ≥ 2 cameras. Vehicles grouped by plate, people by re-ID track."""
    seen = {}
    for d in sorted(current_detections(db, video_ids, min_conf), key=lambda x: x.t_in):
        if len({p["camera_id"] for p in (d.path or [])}) < 2:
            continue
        key = d.plate_norm if d.kind == DetKind.VEHICLE and d.plate_norm else (d.reid_key or d.id)
        seen.setdefault(key, d)
    return list(seen.values())


@router.get("/cases/{case_id}/overview")
def overview(case_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = get_case(db, case_id)
    require(user, "case.meta", c)
    min_conf = user_settings(user)["min_conf"]
    vids = live_videos(db, c.id)
    roots = [v for v in vids if not v.parent_id]
    clips = [v for v in vids if v.parent_id]
    analyzing = [v for v in roots if v.state not in (VideoState.ANALYZED,)]
    can_view = user.role != Role.ADMIN
    dets = current_detections(db, [v.id for v in roots], min_conf) if can_view else []
    tags = db.execute(select(Tag).where(Tag.case_id == c.id)).scalars().all()
    leads = priority_leads(db, c, min_conf, [v.id for v in roots]) if can_view else []
    tag_by_det = {t.detection_id: t.color for t in tags if t.detection_id}
    log = []
    if user.role in (Role.INVESTIGATOR, Role.EXPERT, Role.COMMANDER, Role.ADMIN):
        rows = db.execute(select(AuditLog).where(AuditLog.case_id == c.id).order_by(AuditLog.seq.desc()).limit(300)).scalars()
        log = [{"seq": r.seq, "at": iso(r.at), "actor": r.actor, "action": r.action, "object": r.object} for r in rows]
    return {
        "case": case_out(c),
        "videos": videos_out(db, vids, min_conf),
        "stats": {
            "originals": len(roots), "clips": len(clips), "analyzing": len(analyzing),
            "analyzed": len(roots) - len(analyzing), "duration": sum(v.duration_sec for v in roots),
            "people": sum(1 for d in dets if d.kind == DetKind.PERSON), "vehicles": sum(1 for d in dets if d.kind == DetKind.VEHICLE),
            "tags": len(tags), "report_exported": c.report_exported,
        },
        "leads": [detection_out(d) | {"tag_color": tag_by_det.get(d.id)} for d in leads],
        "audit": log,
    }


@router.get("/cases/{case_id}/audit")
def case_audit(case_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = get_case(db, case_id)
    require(user, "audit.view", c)
    rows = db.execute(select(AuditLog).where(AuditLog.case_id == c.id).order_by(AuditLog.seq.desc())).scalars()
    return [{"seq": r.seq, "at": iso(r.at), "actor": r.actor, "action": r.action, "object": r.object, "hash": r.hash} for r in rows]
