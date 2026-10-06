"""Context-aware assistant (UR-AI-01).

Intent rules run over the data the user may see. Replace `answer()` with a call to the unit's on-premise model (Q13);
keep the context object and the structured reply (text + clickable items + actions).
"""

import re
from datetime import timedelta

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Case, Detection, DetKind, Snapshot, Tag, User, Video, VideoState
from ..serializers import user_settings
from ..services.audit import audit
from ..services.labels import attrs, label, mmss
from ..services.nlq import describe, norm, parse
from ..services.queries import current_detections, live_videos
from .deps import client_ip, current_user, get_case, require
from .search import match_filters, result_items
from .cases import priority_leads

router = APIRouter(prefix="/api/assistant", tags=["assistant"])


class AskIn(BaseModel):
    q: str
    lang: str = "vi"
    tab: str = "case"
    case_id: str
    video_id: str | None = None
    t: float = 0
    snapshot_id: str | None = None
    track_id: str | None = None


def hms(dt) -> str:
    return (dt + timedelta(hours=7)).strftime("%H:%M:%S")


def dmy(dt) -> str:
    return (dt + timedelta(hours=7)).strftime("%d/%m/%Y")


@router.post("/ask")
def ask(body: AskIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    case = get_case(db, body.case_id)
    require(user, "video.view", case)
    reply = answer(db, user, case, body)
    audit(db, "AI_QUESTION", body.q[:300], user=user, ip=client_ip(request), details={"tab": body.tab, "case": case.code, "answer": reply["text"][:500]})
    db.commit()
    return reply


def answer(db: Session, user: User, case: Case, b: AskIn) -> dict:
    vi = b.lang != "en"
    L = lambda a, e: a if vi else e  # noqa: E731
    lang = "vi" if vi else "en"
    s, q = norm(b.q), b.q
    min_conf = user_settings(user)["min_conf"]
    roots = {v.id: v for v in live_videos(db, case.id) if not v.parent_id and v.state == VideoState.ANALYZED}
    dets = current_detections(db, list(roots), min_conf)
    cur = db.get(Video, b.video_id) if b.video_id else None
    snap = db.get(Snapshot, b.snapshot_id) if b.snapshot_id else None
    def items(ds: list[Detection]) -> list[dict]:
        ids = list({d.video_id for d in ds}) or ["-"]
        return result_items(db, ds, {v.id: v for v in db.execute(select(Video).where(Video.id.in_(ids))).scalars()})

    reply = lambda text, **k: {"text": text, "items": [], "actions": [], **k}  # noqa: E731

    # Case summary
    if re.search(r"(vu an|ho so|case)", s) and re.search(r"(tom tat|summar|tong quan|overview)", s):
        vids = list(roots.values())
        leads = priority_leads(db, case, min_conf, list(roots))
        ntags = db.query(Tag).filter(Tag.case_id == case.id).count()
        total = sum(v.duration_sec for v in vids)
        p = sum(1 for d in dets if d.kind == DetKind.PERSON)
        return reply(L(f"{case.code}: {len(vids)} chứng cứ video đã phân tích, tổng {mmss(total)}. AI nhận diện {p} người và {len(dets) - p} phương tiện; {ntags} thẻ đã gắn. "
                       f"{len(leads)} đối tượng xuất hiện ở nhiều camera, nên xác minh trước:",
                       f"{case.code}: {len(vids)} analysed video exhibits, {mmss(total)} in total. AI detected {p} people and {len(dets) - p} vehicles; {ntags} tags so far. "
                       f"{len(leads)} subjects appear on several cameras and should be verified first:"), items=items(leads))

    # Route of a subject
    idm = re.search(r"\b([PX]\d{2,3})\b", q, re.I)
    if idm or re.search(r"lo trinh|route|di chuyen|di dau|where did", s):
        tid = (idm.group(1) if idm else (b.track_id or "P01")).upper()
        pool = [d for d in dets if d.track_id == tid or d.id == b.track_id]
        if cur:
            pool.sort(key=lambda d: d.video_id != cur.id and d.video_id != cur.parent_id)
        d = pool[0] if pool else None
        if not d:
            return reply(L("Không tìm thấy mã đối tượng đó trong vụ án.", "That subject ID is not in this case."))
        steps = [{"camera_id": p["camera_id"], "time": p["time"]} for p in d.path or []]
        return reply(L(f"{label(d, lang)} ({attrs(d, lang)}) đi qua {len(steps)} camera:", f"{label(d, lang)} ({attrs(d, lang)}) passed {len(steps)} cameras:"),
                     route=steps, items=items([d]), actions=[{"type": "map", "detection_id": d.id}, {"type": "view", "detection_id": d.id}])

    # Cross-camera subjects
    if re.search(r"nhieu camera|hai hien truong|ca hai|several cameras|multiple cameras|both scenes|cross", s):
        leads = priority_leads(db, case, min_conf, list(roots))
        return reply(L(f"{len(leads)} đối tượng được ghi nhận ở hơn một camera. Đây là các đầu mối đáng ưu tiên:",
                       f"{len(leads)} subjects were seen on more than one camera. These are your strongest leads:"), items=items(leads))

    # A specific plate
    pm = re.search(r"\d{2}[A-Z]-?\d{3}\.?\d{2}", q, re.I)
    if pm:
        from ..domain import plate_norm

        pn = plate_norm(pm.group(0))
        hits = [d for d in dets if d.kind == DetKind.VEHICLE and d.plate_norm == pn]
        cams = sorted({roots[d.video_id].camera_id for d in hits})
        if not hits:
            return reply(L("Chưa thấy biển số này trong các video đã phân tích.", "This plate is not in any analysed video yet."))
        return reply(L(f"Biển {hits[0].plate_text} xuất hiện {len(hits)} lần, tại {', '.join(cams)}:", f"Plate {hits[0].plate_text} appears {len(hits)} times, at {', '.join(cams)}:"),
                     items=items(hits), actions=[{"type": "map", "detection_id": hits[0].id}])

    # Plates in the current image, or every plate in the case
    if re.search(r"bien so|plate|ocr|bien xe", s):
        if b.tab == "image" and snap and any(a["type"] == "plate" for a in snap.annotations or []):
            ps = [a for a in snap.annotations if a["type"] == "plate"]
            low = any(a["c"] < 70 for a in ps)
            return reply(L(f"Đọc được {len(ps)} biển số trong khung này." + (" Có biển dưới 70%: bật tình huống \"Đọc biển số\" rồi hỏi lại." if low else ""),
                           f"Read {len(ps)} plates in this frame." + (" Some are under 70%: try the \"Read plate\" scenario, then ask again." if low else "")),
                         plates=[{"plate": a["plate"], "confidence": a["c"], "id": a["id"]} for a in ps])
        by: dict[str, list[Detection]] = {}
        for d in dets:
            if d.kind == DetKind.VEHICLE and d.plate_text:
                by.setdefault(d.plate_text, []).append(d)
        rows = [{"plate": p, "cameras": sorted({roots[d.video_id].camera_id for d in ds}), "multi": len({roots[d.video_id].camera_id for d in ds}) > 1, "id": ds[0].id}
                for p, ds in by.items()]
        return reply(L(f"Có {len(rows)} biển số trong các video đã phân tích. Biển xuất hiện ở nhiều nơi được đánh dấu:",
                       f"{len(rows)} plates across analysed videos. Plates seen at several places are flagged:"), plates=rows)

    # Tags
    if re.search(r"\b(cac the|the danh dau|tags?|bookmarks?)\b", s) and re.search(r"tom tat|summar|list|liet ke", s):
        tags = db.execute(select(Tag).where(Tag.case_id == case.id).order_by(Tag.created_at.desc())).scalars().all()
        return reply(L(f"Bạn có {len(tags)} thẻ:", f"You have {len(tags)} tags:"),
                     tags=[{"color": t.color, "note": t.note, "video_id": t.video_id, "t": t.t} for t in tags if t.video_id in roots or db.get(Video, t.video_id)])

    # Timestamp
    if re.search(r"thoi gian|dau thoi gian|timestamp|time stamp|may gio|luc nao|what time", s):
        v, t = (db.get(Video, snap.video_id), snap.t) if (b.tab == "image" and snap and snap.video_id) else (cur, b.t)
        if not v:
            return reply(L("Ảnh tải lên không có dấu thời gian đọc được.", "The uploaded image has no readable timestamp."))
        at = v.recorded_start + timedelta(seconds=t)
        return reply(L(f"Dấu thời gian trên khung hình là {hms(at)} ngày {dmy(at)}, camera {v.camera_id}. Khớp với siêu dữ liệu của tệp video.",
                       f"The frame timestamp reads {hms(at)} on {dmy(at)}, camera {v.camera_id}. It matches the video file metadata."))

    def scene() -> tuple[list[Detection], str]:
        if b.tab == "image" and snap:
            ids = {a["id"] for a in snap.annotations or [] if a["type"] in ("person", "vehicle")}
            ds = list(db.execute(select(Detection).where(Detection.id.in_(ids or ["-"]))).scalars())
            v = db.get(Video, snap.video_id) if snap.video_id else None
            return ds, (f"{v.camera_id}, {hms(v.recorded_start + timedelta(seconds=snap.t))}" if v else "")
        if cur and cur.state == VideoState.ANALYZED:
            ds = [d for d in db.execute(select(Detection).where(Detection.video_id == cur.id, Detection.analysis_version == cur.analysis_version,
                                                                Detection.confidence >= min_conf)).scalars() if d.t_in <= b.t <= d.t_out]
            return ds, f"{cur.camera_id}, {hms(cur.recorded_start + timedelta(seconds=b.t))}"
        return [], ""

    if re.search(r"dem|bao nhieu|count|how many", s):
        ds, _ = scene()
        p = sum(1 for d in ds if d.kind == DetKind.PERSON)
        extra = ""
        if b.tab == "footage" and cur and cur.state == VideoState.ANALYZED:
            total = db.query(Detection).filter(Detection.video_id == cur.id, Detection.analysis_version == cur.analysis_version, Detection.kind == DetKind.PERSON).count()
            extra = L(f" Cả video có {total} người khác nhau.", f" The whole video has {total} distinct people.")
        return reply(L(f"Trong khung hiện tại có {p} người và {len(ds) - p} phương tiện.", f"This frame has {p} people and {len(ds) - p} vehicles.") + extra, items=items(ds))

    if re.search(r"mo ta|canh|describe|scene|co gi|what is|what's", s):
        ds, where = scene()
        if not ds:
            return reply(L("Khung này chưa có đối tượng nào được nhận diện.", "No subjects detected in this frame."))
        lines = "; ".join(f"{d.track_id}: {attrs(d, lang)}" for d in ds)
        return reply(L(f"{where}. Có {len(ds)} đối tượng: {lines}.", f"{where}. {len(ds)} subjects: {lines}."), items=items(ds))

    if re.search(r"tom tat|summar|tong quan|overview", s):
        if not cur or cur.state != VideoState.ANALYZED:
            return reply(L("Video này chưa phân tích xong.", "This video is still being analysed."))
        ds = [d for d in db.execute(select(Detection).where(Detection.video_id == cur.id, Detection.analysis_version == cur.analysis_version)).scalars()]
        bins = max(1, int(cur.duration_sec // 10) + 1)
        counts = [sum(1 for d in ds if d.t_in < (i + 1) * 10 and d.t_out >= i * 10) for i in range(bins)]
        peak = counts.index(max(counts)) if counts else 0
        multi = [d for d in ds if len({p["camera_id"] for p in d.path or []}) > 1]
        p = sum(1 for d in ds if d.kind == DetKind.PERSON)
        return reply(L(f"{cur.camera_id}, dài {mmss(cur.duration_sec)}. Ghi nhận {p} người và {len(ds) - p} phương tiện. Đông nhất trong 10 giây bắt đầu lúc "
                       f"{hms(cur.recorded_start + timedelta(seconds=peak * 10))}. {len(multi)} đối tượng còn xuất hiện ở camera khác.",
                       f"{cur.camera_id}, {mmss(cur.duration_sec)} long. {p} people and {len(ds) - p} vehicles. Busiest 10 seconds start at "
                       f"{hms(cur.recorded_start + timedelta(seconds=peak * 10))}. {len(multi)} subjects also appear on other cameras."),
                     items=items(multi), actions=[{"type": "seek", "video_id": cur.id, "t": peak * 10, "label": hms(cur.recorded_start + timedelta(seconds=peak * 10))}])

    parsed = parse(q)
    if not parsed["empty"]:
        f, vehicle = parsed["filters"], parsed["vehicle"]
        pool = [d for d in dets if (d.kind == DetKind.VEHICLE) == vehicle and match_filters(d, f, roots[d.video_id].recorded_start)]
        desc = ", ".join(describe(f, lang, vehicle))
        if not pool:
            return reply(L(f'Không có ai khớp "{desc}". Thử bỏ bớt một thuộc tính.', f'Nobody matches "{desc}". Try dropping an attribute.'))
        return reply(L(f'Tìm thấy {len(pool)} kết quả khớp "{desc}" trong các video đã phân tích:', f'Found {len(pool)} matches for "{desc}" across analysed videos:'),
                     items=items(pool[:6]), more=max(0, len(pool) - 6), actions=[{"type": "apply", "q": q}])

    return reply(L('Tôi có thể mô tả cảnh, đếm người, đọc dấu thời gian và biển số, tóm tắt video hoặc vụ án, tìm theo mô tả (ví dụ "nữ áo đỏ mang túi") hoặc truy lộ trình một đối tượng (ví dụ "lộ trình P01").',
                   'I can describe the scene, count people, read timestamps and plates, summarise a video or the case, search by description (e.g. "woman in red with a bag") or trace a subject (e.g. "route of P01").'))
