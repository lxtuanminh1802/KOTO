"""Image lab (UR-IMG-01..06): frames, uploads, processed exports with AI labels, redaction, report attachments."""

import io
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, File, Request, UploadFile
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps, UnidentifiedImageError
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Case, DerivedFile, Snapshot, User, Video, utcnow
from ..security import sha256_file
from ..serializers import iso, user_settings
from ..services import media
from ..services.audit import audit
from ..services.labels import mmss
from ..services.vision import save_jpeg
from .deps import ApiError, client_ip, current_user, get_case, require

router = APIRouter(prefix="/api", tags=["images"])
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def _font(size: int, bold: bool = False):
    try:
        return ImageFont.truetype(FONT_B if bold else FONT, size)
    except OSError:
        return ImageFont.load_default()


def caption(s: Snapshot, lang: str = "vi") -> str:
    if s.uploaded or not s.video_id:
        return "Ảnh tải lên" if lang == "vi" else "Uploaded image"
    c, parts = s.counts or {}, []
    if c.get("p"):
        parts.append(f"{c['p']} người")
    if c.get("v"):
        parts.append(f"{c['v']} xe")
        parts.append("biển số rõ" if c.get("plate_ok") else "biển số mờ")
    return ", ".join(parts) or "Không có đối tượng"


def snapshot_out(db: Session, s: Snapshot) -> dict:
    v = db.get(Video, s.video_id) if s.video_id else None
    return {"id": s.id, "case_id": s.case_id, "video_id": s.video_id, "t": s.t, "url": f"/api/media/snapshots/{s.id}", "annotations": s.annotations,
            "counts": s.counts, "score": s.score, "uploaded": s.uploaded, "in_report": s.in_report, "caption": caption(s),
            "evidence_id": v.evidence_id if v else None, "camera_id": v.camera_id if v else None,
            "abs_time": iso(v.recorded_start + timedelta(seconds=s.t)) if v else None, "created_at": iso(s.created_at)}


class LabParams(BaseModel):
    b: float = 100
    c: float = 100
    s: float = 100
    k: float = 0
    gray: bool = False
    invert: bool = False
    edge: bool = False
    layers: dict = {"person": True, "vehicle": True, "plate": True, "face": False}
    redact: bool = False
    ai: bool = False  # any AI processing applied (adds the disclaimer even without the watermark band)


def _snap(db: Session, sid: str) -> Snapshot:
    s = db.get(Snapshot, sid)
    if not s or s.deleted_at:
        raise ApiError(404, "snapshot.not_found", "Không tìm thấy khung hình.", "Frame not found.")
    return s


@router.get("/cases/{case_id}/snapshots")
def list_snaps(case_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    case = get_case(db, case_id)
    require(user, "video.view", case)
    rows = db.execute(select(Snapshot).where(Snapshot.case_id == case.id, Snapshot.deleted_at.is_(None))).scalars().all()
    live = {v.id for v in db.execute(select(Video).where(Video.case_id == case.id, Video.deleted_at.is_(None))).scalars()}
    rows = [s for s in rows if not s.video_id or s.video_id in live]
    rows.sort(key=lambda s: (-s.score, s.created_at))
    attached = sum(1 for s in rows if s.in_report) + db.query(DerivedFile).filter(DerivedFile.case_id == case.id, DerivedFile.in_report.is_(True)).count()
    return {"snapshots": [snapshot_out(db, s) for s in rows], "attachments": attached}


@router.post("/cases/{case_id}/snapshots/upload")
async def upload_image(case_id: str, file: UploadFile = File(...), user: User = Depends(current_user), db: Session = Depends(get_db)):
    case = get_case(db, case_id)
    require(user, "video.edit", case)
    try:
        img = Image.open(io.BytesIO(await file.read())).convert("RGB")
    except UnidentifiedImageError:
        raise ApiError(422, "image.bad", f"'{file.filename}' không phải ảnh.", f"'{file.filename}' is not an image.")
    s = Snapshot(case_id=case.id, image_path="", uploaded=True, score=-1, counts={}, annotations=[], created_by=user.id)
    db.add(s)
    db.flush()
    s.image_path = save_jpeg(img, media.derived_path("snapshots", case.id, f"{s.id}.jpg"))
    s.sha256 = sha256_file(media.absolute(s.image_path))
    db.commit()
    return snapshot_out(db, s)


@router.delete("/snapshots/{sid}")
def delete_snap(sid: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = _snap(db, sid)
    require(user, "video.edit", get_case(db, s.case_id))
    s.deleted_at = utcnow()
    db.commit()
    return {"ok": True}


def render(db: Session, s: Snapshot, p: LabParams, user: User) -> Image.Image:
    """1600×900 export: processed pixels, AI labels, redaction and the evidence band (UR-IMG-06)."""
    st = user_settings(user)
    W, H = 1600, 900
    src = Image.open(media.absolute(s.image_path)).convert("RGB")
    img = ImageOps.fit(src, (W, H), Image.LANCZOS)
    if p.b != 100:
        img = ImageEnhance.Brightness(img).enhance(p.b / 100)
    if p.c != 100:
        img = ImageEnhance.Contrast(img).enhance(p.c / 100)
    if p.s != 100:
        img = ImageEnhance.Color(img).enhance(p.s / 100)
    if p.k > 0:
        img = img.filter(ImageFilter.UnsharpMask(radius=2, percent=int(min(400, p.k * 90)), threshold=2))
    if p.edge:
        img = img.filter(ImageFilter.FIND_EDGES)
    if p.gray:
        img = ImageOps.grayscale(img).convert("RGB")
    if p.invert:
        img = ImageOps.invert(img)
    d = ImageDraw.Draw(img)
    redact = p.redact or st["auto_redact"]
    for a in s.annotations or []:
        x, y, w, h = a["x"] / 100 * W, a["y"] / 100 * H, a["w"] / 100 * W, a["h"] / 100 * H
        box = (int(x), int(y), int(x + w), int(y + h))
        if redact and a["type"] in ("face", "plate"):
            region = img.crop(box).filter(ImageFilter.GaussianBlur(14))
            img.paste(region, box)
            continue
        if not p.layers.get(a["type"]):
            continue
        d.rectangle(box, outline="white", width=3)
        lbl = a.get("plate") if a["type"] == "plate" else f"{a.get('track_id', a['type'])} {a['c']}%"
        f = _font(20, True)
        tw = d.textlength(lbl, font=f) + 12
        d.rectangle((box[0], box[1] - 28, box[0] + tw, box[1] - 2), fill=(0, 0, 0))
        d.text((box[0] + 6, box[1] - 26), lbl, font=f, fill="white")
    if st["watermark"]:
        case = db.get(Case, s.case_id)
        v = db.get(Video, s.video_id) if s.video_id else None
        now = datetime.utcnow() + timedelta(hours=7)
        where = f"{v.camera_id} {mmss(s.t)}" if v else "Ảnh tải lên"
        band = f"Video Master AI | {case.code} | {where} | Ảnh đã xử lý bằng AI, không phải ảnh gốc | {now:%d/%m/%Y %H:%M:%S}"
        d.rectangle((0, H - 40, W, H), fill=(0, 0, 0))
        d.text((16, H - 32), band, font=_font(18), fill="white")
    return img


def _derive(db: Session, s: Snapshot, p: LabParams, user: User, in_report: bool) -> DerivedFile:
    img = render(db, s, p, user)
    df = DerivedFile(case_id=s.case_id, kind="processed_image", source_snapshot_id=s.id, source_video_id=s.video_id, file_name="", path="",
                     params=p.model_dump(), in_report=in_report, created_by=user.id)
    db.add(df)
    db.flush()
    dst = media.derived_path("processed", s.case_id, f"{df.id}.png")
    img.save(dst, "PNG")
    df.file_name = f"VMA_AI_{(datetime.utcnow() + timedelta(hours=7)):%Y%m%d_%H%M%S}.png"
    df.path, df.sha256 = media.rel(dst), sha256_file(dst)
    return df


@router.post("/snapshots/{sid}/export")
def export_image(sid: str, p: LabParams, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = _snap(db, sid)
    require(user, "video.edit", get_case(db, s.case_id))
    df = _derive(db, s, p, user, in_report=False)
    v = db.get(Video, s.video_id) if s.video_id else None
    audit(db, "IMAGE_EXPORT", f"{df.file_name} · {(v.evidence_id + ' @ ' + mmss(s.t)) if v else 'ảnh tải lên'}", user=user, case_id=s.case_id, ip=client_ip(request),
          details={"derived": df.id, "sha256": df.sha256, "params": p.model_dump()})
    db.commit()
    return {"id": df.id, "file_name": df.file_name, "sha256": df.sha256, "url": f"/api/media/derived/{df.id}"}


@router.post("/snapshots/{sid}/to-report")
def to_report(sid: str, p: LabParams, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = _snap(db, sid)
    require(user, "video.edit", get_case(db, s.case_id))
    processed = p.ai or p.redact or any(getattr(p, k) != v for k, v in (("b", 100), ("c", 100), ("s", 100), ("k", 0)))
    if processed:
        _derive(db, s, p, user, in_report=True)
    else:
        s.in_report = True
    v = db.get(Video, s.video_id) if s.video_id else None
    audit(db, "IMAGE_TO_REPORT", f"{v.evidence_id} @ {mmss(s.t)}" if v else "Ảnh tải lên", user=user, case_id=s.case_id, ip=client_ip(request))
    db.commit()
    attached = db.query(Snapshot).filter(Snapshot.case_id == s.case_id, Snapshot.in_report.is_(True), Snapshot.deleted_at.is_(None)).count() + \
        db.query(DerivedFile).filter(DerivedFile.case_id == s.case_id, DerivedFile.in_report.is_(True)).count()
    return {"attachments": attached}
