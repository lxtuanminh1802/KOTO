"""PDF report and evidence package endpoints."""

from fastapi import APIRouter, Depends, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import ExportPackage, Integrity, Report, User
from ..serializers import iso
from ..services import media
from ..services.audit import audit
from ..services.events import notify
from ..services.integrity import verify_video
from ..services.reporting import build_package, build_pdf, package_parts
from .deps import ApiError, client_ip, current_user, get_case, require

router = APIRouter(prefix="/api/cases", tags=["exports"])


class ReportIn(BaseModel):
    detection_ids: list[str] = []
    query: str = ""


class PackageIn(BaseModel):
    video: bool = True
    clips: bool = True
    images: bool = True
    dets: bool = True
    tags: bool = True
    log: bool = True
    report: bool = True


@router.post("/{case_id}/report")
async def report(case_id: str, body: ReportIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    case = get_case(db, case_id)
    require(user, "report.pdf", case)
    path, sha, n = await run_in_threadpool(build_pdf, db, case, user, body.detection_ids, body.query)
    r = Report(case_id=case.id, file_name=path.name.split("_", 1)[1], path=media.rel(path), sha256=sha, results_count=n, created_by=user.id)
    db.add(r)
    case.report_exported = True
    db.flush()
    audit(db, "REPORT_PDF", f"{r.file_name} · {n} kết quả · SHA-256 {sha[:8]}…", user=user, case_id=case.id, ip=client_ip(request), details={"report": r.id, "sha256": sha})
    notify(db, {user.id}, kind="report", tone="ok", title=(f"Báo cáo PDF sẵn sàng, {n} kết quả", f"PDF report ready, {n} results"),
           body=(r.file_name, r.file_name), link={"download": f"/api/media/reports/{r.id}"})
    db.commit()
    return {"id": r.id, "file_name": r.file_name, "sha256": sha, "count": n, "url": f"/api/media/reports/{r.id}"}


@router.get("/{case_id}/package/preview")
def preview(case_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    case = get_case(db, case_id)
    require(user, "package", case)
    P = package_parts(db, case)
    return {"video": len(P["roots"]), "clips": len(P["clips"]), "images": len(P["snaps"]) + len(P["derived"]), "dets": len(P["dets"]),
            "tags": len(P["tags"]), "log": len(P["log"]), "report": 1, "blocked": [v.evidence_id for v in P["roots"] if v.integrity == Integrity.MISMATCH]}


@router.post("/{case_id}/package")
async def package(case_id: str, body: PackageIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    case = get_case(db, case_id)
    require(user, "package", case)
    # WF-08: re-verify every original before packing; any mismatch stops the export.
    roots = package_parts(db, case)["roots"]
    bad = []
    for v in roots:
        if not await run_in_threadpool(verify_video, db, v, user):
            bad.append(v.evidence_id)
    if bad:
        audit(db, "PACKAGE_BLOCKED", ", ".join(bad), user=user, case_id=case.id, ip=client_ip(request))
        db.commit()
        raise ApiError(409, "package.integrity", f"Dừng xuất gói: mã băm không khớp ({', '.join(bad)}).", f"Export stopped: hash mismatch ({', '.join(bad)}).", videos=bad)
    for v in roots:
        audit(db, "EVIDENCE_VERIFY_OK", v.evidence_id or "", user=user, case_id=case.id)
    db.commit()
    res = await run_in_threadpool(build_package, db, case, user, body.model_dump())
    pkg = ExportPackage(case_id=case.id, file_name=res["file_name"], path=media.rel(res["path"]), sha256=res["sha256"], size_bytes=res["size"],
                        file_count=len(res["files"]), parts=body.model_dump(), files=res["files"], created_by=user.id)
    db.add(pkg)
    db.flush()
    audit(db, "PACKAGE_EXPORT", f"{pkg.file_name} · {pkg.file_count} tệp · SHA-256 {pkg.sha256}", user=user, case_id=case.id, ip=client_ip(request),
          details={"package": pkg.id, "sha256": pkg.sha256, "parts": body.model_dump()})
    db.commit()
    return {"id": pkg.id, "file_name": pkg.file_name, "sha256": pkg.sha256, "size": pkg.size_bytes, "file_count": pkg.file_count, "files": pkg.files,
            "url": f"/api/media/packages/{pkg.id}", "created_at": iso(pkg.created_at)}


@router.get("/{case_id}/exports")
def history(case_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    case = get_case(db, case_id)
    require(user, "report.pdf", case)
    reps = db.execute(select(Report).where(Report.case_id == case.id).order_by(Report.created_at.desc())).scalars()
    return [{"id": r.id, "file_name": r.file_name, "sha256": r.sha256, "url": f"/api/media/reports/{r.id}", "at": iso(r.created_at)} for r in reps]
