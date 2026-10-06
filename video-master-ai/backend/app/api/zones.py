"""Detection zones (WF-07, UR-ZONE-01..04)."""

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Detection, User, Video, Zone, ZoneHit, utcnow
from ..serializers import user_settings
from ..services.analysis import compute_zone
from ..services.audit import audit
from .deps import ApiError, client_ip, current_user, get_case, get_video, require
from .search import match_filters, result_items

router = APIRouter(prefix="/api/zones", tags=["zones"])


class ZoneIn(BaseModel):
    video_id: str
    name: str
    polygon: list[list[float]]
    people: bool = True
    vehicles: bool = True


class ZoneQuery(BaseModel):
    video_ids: list[str] = []
    filters: dict = {}


@router.post("/query")
def query(body: ZoneQuery, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "search")
    min_conf = user_settings(user)["min_conf"]
    vids = {v.id: v for v in db.execute(select(Video).where(Video.id.in_(body.video_ids or ["-"]), Video.deleted_at.is_(None))).scalars()}
    zones = db.execute(select(Zone).where(Zone.video_id.in_(list(vids) or ["-"]), Zone.deleted_at.is_(None)).order_by(Zone.created_at)).scalars().all()
    out, total = [], 0
    for z in zones:
        v = vids[z.video_id]
        if z.analyzed_version != v.analysis_version and v.state.value == "ANALYZED":
            compute_zone(db, z)
            db.commit()
        hits = db.execute(select(ZoneHit).where(ZoneHit.zone_id == z.id)).scalars().all()
        dets = {d.id: d for d in db.execute(select(Detection).where(Detection.id.in_([h.detection_id for h in hits] or ["-"]))).scalars()}
        keep = [h for h in sorted(hits, key=lambda h: h.enter_t) if h.detection_id in dets and dets[h.detection_id].confidence >= min_conf
                and match_filters(dets[h.detection_id], body.filters or {}, v.recorded_start)]
        items = result_items(db, [dets[h.detection_id] for h in keep], vids, {h.detection_id: {"enter_t": h.enter_t, "exit_t": h.exit_t} for h in keep})
        total += len(items)
        out.append({"id": z.id, "code": z.code, "name": z.name, "video_id": v.id, "evidence_id": v.evidence_id, "video_name": v.display_name,
                    "polygon": z.polygon, "people": z.people, "vehicles": z.vehicles, "pending": z.analyzed_version == 0, "hits": items,
                    "thumb_t": keep[0].enter_t if keep else v.duration_sec / 2})
    return {"zones": out, "count": total}


@router.post("")
def create(body: ZoneIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    v = get_video(db, body.video_id)
    case = get_case(db, v.case_id)
    require(user, "zone", case)
    pts = [[round(min(100, max(0, x)), 2), round(min(100, max(0, y)), 2)] for x, y in body.polygon]
    if len(pts) < 3:
        raise ApiError(422, "zone.points", "Vùng cần tối thiểu 3 điểm.", "A zone needs at least 3 points.")
    if not body.name.strip():
        raise ApiError(422, "zone.name", "Đặt tên cho vùng.", "Name the zone.")
    if not (body.people or body.vehicles):
        raise ApiError(422, "zone.kinds", "Chọn ít nhất Người hoặc Phương tiện.", "Pick People or Vehicles.")
    n = db.execute(select(func.count()).select_from(Zone).where(Zone.case_id == case.id)).scalar() or 0
    z = Zone(code=f"Z{n + 1:02d}", video_id=v.id, case_id=case.id, name=body.name.strip()[:255], polygon=pts, people=body.people, vehicles=body.vehicles, created_by=user.id)
    db.add(z)
    db.flush()
    count = compute_zone(db, z)
    audit(db, "ZONE_CREATE", f"{z.name} · {v.evidence_id} · " + (f"{count} đối tượng" if count is not None else "chờ phân tích video"),
          user=user, case_id=case.id, ip=client_ip(request), details={"zone": z.id, "polygon": pts})
    db.commit()
    return {"id": z.id, "pending": count is None, "count": count or 0}


@router.delete("/{zone_id}")
def delete(zone_id: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    z = db.get(Zone, zone_id)
    if not z or z.deleted_at:
        raise ApiError(404, "zone.not_found", "Không tìm thấy vùng.", "Zone not found.")
    require(user, "zone", get_case(db, z.case_id))
    z.deleted_at = utcnow()
    audit(db, "ZONE_DELETE", z.name, user=user, case_id=z.case_id, ip=client_ip(request))
    db.commit()
    return {"ok": True}
