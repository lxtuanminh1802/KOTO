"""PDF report (UR-RPT-01) and evidence package (UR-RPT-03, WF-08)."""

import csv
import hashlib
import html
import io
import json
import zipfile
from datetime import datetime, timedelta
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.platypus import Image as RLImage
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..domain import SOURCE_LABEL, analysis_label, color_name
from ..models import AuditLog, Case, DerivedFile, Detection, DetKind, Snapshot, Tag, User, Video, Zone, ZoneHit
from . import media
from .audit import label as action_label
from .labels import attrs, label, mmss
from .queries import current_detections, live_videos

FONT_DIR = Path("/usr/share/fonts/truetype/dejavu")
_fonts = False


def local(dt: datetime | None) -> str:
    return (dt + timedelta(hours=7)).strftime("%d/%m/%Y %H:%M:%S") if dt else ""


def _register_fonts() -> None:
    global _fonts
    if not _fonts:
        pdfmetrics.registerFont(TTFont("DejaVu", str(FONT_DIR / "DejaVuSans.ttf")))
        pdfmetrics.registerFont(TTFont("DejaVu-Bold", str(FONT_DIR / "DejaVuSans-Bold.ttf")))
        pdfmetrics.registerFont(TTFont("DejaVuMono", str(FONT_DIR / "DejaVuSansMono.ttf")))
        _fonts = True


# --------------------------------------------------------------------------------------------- PDF
def build_pdf(db: Session, case: Case, user: User, det_ids: list[str], query_desc: str) -> tuple[Path, str, int]:
    _register_fonts()
    now = datetime.utcnow()
    name = f"BaoCao_{case.code}_{(now + timedelta(hours=7)):%d%m%Y}.pdf"
    dst = get_settings().export_dir / case.code / f"{now:%Y%m%d%H%M%S}_{name}"
    dst.parent.mkdir(parents=True, exist_ok=True)

    body = ParagraphStyle("b", fontName="DejaVu", fontSize=9, leading=12)
    small = ParagraphStyle("s", parent=body, fontSize=7.5, leading=10, textColor=colors.HexColor("#556072"))
    h1 = ParagraphStyle("h1", parent=body, fontName="DejaVu-Bold", fontSize=15, leading=20, spaceAfter=4)
    h2 = ParagraphStyle("h2", parent=body, fontName="DejaVu-Bold", fontSize=11, leading=15, spaceBefore=10, spaceAfter=6)
    mono = ParagraphStyle("m", parent=body, fontName="DejaVuMono", fontSize=7, leading=9)

    dets = [d for d in db.execute(select(Detection).where(Detection.id.in_(det_ids or ["-"]))).scalars()]
    vids = {v.id: v for v in db.execute(select(Video).where(Video.id.in_([d.video_id for d in dets] or ["-"]))).scalars()}
    order = {i: n for n, i in enumerate(det_ids)}
    dets.sort(key=lambda d: order.get(d.id, 0))

    story = [Paragraph("BÁO CÁO KẾT QUẢ PHÂN TÍCH VIDEO", h1),
             Paragraph(f"Vụ án <b>{html.escape(case.code)}</b> · {html.escape(case.title)} · Quyết định {html.escape(case.decision_no)}", body),
             Paragraph(f"Điều tra viên phụ trách: {html.escape(case.lead.full_name if case.lead else '')} · Người xuất: {html.escape(user.full_name)} · "
                       f"Thời điểm xuất: {local(now)} (GMT+7)", body),
             Spacer(1, 4),
             Paragraph(f"Điều kiện tìm: {html.escape(query_desc or 'tất cả đối tượng trong phạm vi')}", small),
             Paragraph("Kết quả nhận diện bằng AI là gợi ý điều tra, phải được điều tra viên xác minh với dữ liệu gốc trước khi đưa vào hồ sơ (NFR-PRIV-01).", small),
             Paragraph(f"Kết quả ({len(dets)} đối tượng)", h2)]
    rows = [[Paragraph("<b>Ảnh</b>", body), Paragraph("<b>Đối tượng</b>", body), Paragraph("<b>Chứng cứ · thời điểm</b>", body), Paragraph("<b>Tin cậy</b>", body)]]
    for d in dets:
        v = vids[d.video_id]
        img_path = media.absolute(d.crop_path) if d.crop_path else None
        cell_img = RLImage(str(img_path), width=18 * mm, height=24 * mm if d.kind == DetKind.PERSON else 14 * mm, kind="proportional") if img_path and img_path.exists() else ""
        desc = f"<b>{html.escape(label(d))}</b><br/>{html.escape(attrs(d))}"
        if d.plate_text:
            desc += f"<br/>Biển số: <font name='DejaVuMono'>{html.escape(d.plate_text)}</font> ({d.plate_confidence:.0f}%)"
        when = v.recorded_start + timedelta(seconds=d.t_in)
        rows.append([cell_img, Paragraph(desc, body), Paragraph(f"{html.escape(v.evidence_id or '')}<br/>{html.escape(v.camera_id)}<br/>{local(when)}", body),
                     Paragraph(f"{d.confidence:.0f}%", body)])
    t = Table(rows, colWidths=[22 * mm, 75 * mm, 55 * mm, 20 * mm], repeatRows=1)
    t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#CBD3DE")), ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F0F3F7")),
                           ("VALIGN", (0, 0), (-1, -1), "TOP"), ("FONTNAME", (0, 0), (-1, -1), "DejaVu")]))
    story.append(t)

    snaps = db.execute(select(Snapshot).where(Snapshot.case_id == case.id, Snapshot.in_report.is_(True), Snapshot.deleted_at.is_(None))).scalars().all()
    derived = db.execute(select(DerivedFile).where(DerivedFile.case_id == case.id, DerivedFile.in_report.is_(True))).scalars().all()
    if snaps or derived:
        story += [PageBreak(), Paragraph(f"Ảnh minh họa ({len(snaps) + len(derived)})", h2)]
        for s in snaps:
            v = db.get(Video, s.video_id) if s.video_id else None
            story += [RLImage(str(media.absolute(s.image_path)), width=170 * mm, height=95 * mm, kind="proportional"),
                      Paragraph(f"{v.evidence_id} · {v.camera_id} · {mmss(s.t)}" if v else "Ảnh tải lên", small), Spacer(1, 6)]
        for df in derived:
            story += [RLImage(str(media.absolute(df.path)), width=170 * mm, height=95 * mm, kind="proportional"),
                      Paragraph(f"{html.escape(df.file_name)} · Ảnh đã xử lý bằng AI, không phải ảnh gốc · SHA-256 {df.sha256}", small), Spacer(1, 6)]

    cited = {v.id: v for v in vids.values()}
    for s in snaps:
        if s.video_id and s.video_id not in cited:
            cited[s.video_id] = db.get(Video, s.video_id)
    story += [PageBreak(), Paragraph("Bảng mã băm chứng cứ được trích dẫn", h2)]
    hrows = [[Paragraph("<b>Mã</b>", body), Paragraph("<b>Tệp</b>", body), Paragraph("<b>SHA-256</b>", body)]]
    for v in sorted(cited.values(), key=lambda x: x.evidence_id or ""):
        hrows.append([Paragraph(html.escape(v.evidence_id or ""), body), Paragraph(html.escape(v.original_file_name), body), Paragraph(v.sha256 or "", mono)])
    ht = Table(hrows, colWidths=[30 * mm, 55 * mm, 87 * mm], repeatRows=1)
    ht.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#CBD3DE")), ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F0F3F7")), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story.append(ht)

    header = f"{case.code} · Người xuất: {user.full_name} · {local(now)}"

    class Numbered(rl_canvas.Canvas):
        def __init__(self, *a, **k):
            super().__init__(*a, **k)
            self._pages = []

        def showPage(self):
            self._pages.append(dict(self.__dict__))
            self._startPage()

        def save(self):
            total = len(self._pages)
            for st in self._pages:
                self.__dict__.update(st)
                self.setFont("DejaVu", 7.5)
                self.setFillColor(colors.HexColor("#556072"))
                self.drawString(18 * mm, A4[1] - 12 * mm, f"Video Master AI · {header}")
                self.drawRightString(A4[0] - 18 * mm, 10 * mm, f"Trang {self._pageNumber}/{total}")
                super().showPage()
            super().save()

    doc = SimpleDocTemplate(str(dst), pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=18 * mm, bottomMargin=16 * mm,
                            title=name, author=user.full_name)
    doc.build(story, canvasmaker=Numbered)
    sha = hashlib.sha256(dst.read_bytes()).hexdigest()
    return dst, sha, len(dets)


# --------------------------------------------------------------------------------------------- ZIP
def _csv(rows: list[list]) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf, quoting=csv.QUOTE_ALL, lineterminator="\r\n")
    w.writerows([[("" if x is None else x) for x in r] for r in rows])
    return ("﻿" + buf.getvalue()).encode("utf-8")


def package_parts(db: Session, case: Case) -> dict:
    vids = live_videos(db, case.id)
    roots = [v for v in vids if not v.parent_id]
    clips = [v for v in vids if v.parent_id]
    ids = [v.id for v in vids]
    snaps = [s for s in db.execute(select(Snapshot).where(Snapshot.case_id == case.id, Snapshot.deleted_at.is_(None))).scalars() if not s.video_id or s.video_id in ids]
    derived = db.execute(select(DerivedFile).where(DerivedFile.case_id == case.id, DerivedFile.kind == "processed_image")).scalars().all()
    dets = current_detections(db, [v.id for v in roots])
    tags = db.execute(select(Tag).where(Tag.case_id == case.id, Tag.video_id.in_(ids or ["-"]))).scalars().all()
    log = db.execute(select(AuditLog).where(AuditLog.case_id == case.id).order_by(AuditLog.seq)).scalars().all()
    zones = db.execute(select(Zone).where(Zone.case_id == case.id, Zone.deleted_at.is_(None), Zone.video_id.in_(ids or ["-"]))).scalars().all()
    return {"roots": roots, "clips": clips, "snaps": snaps, "derived": derived, "dets": dets, "tags": tags, "log": log, "zones": zones}


def build_package(db: Session, case: Case, user: User, opt: dict) -> dict:
    P = package_parts(db, case)
    now = datetime.utcnow()
    base = f"GoiChungCu_{case.code}_{(now + timedelta(hours=7)):%Y%m%d}"
    dst = get_settings().export_dir / case.code / f"{now:%Y%m%d%H%M%S}_{base}.zip"
    dst.parent.mkdir(parents=True, exist_ok=True)
    byid = {v.id: v for v in P["roots"] + P["clips"]}
    entries: list[tuple[str, Path | bytes, str | None]] = []  # (path, source, known sha256)

    if opt.get("video"):
        for v in P["roots"]:
            if v.storage_path:
                entries.append((f"01_video_goc/{v.evidence_id}_{v.original_file_name}", media.absolute(v.storage_path), v.sha256))
    if opt.get("clips"):
        for c in P["clips"]:
            root = byid.get(c.parent_id)
            meta = {"ma_chung_cu": c.evidence_id, "ten": c.display_name, "video_goc": root.evidence_id if root else None, "bat_dau": mmss(c.clip_start or 0),
                    "ket_thuc": mmss(c.clip_end or 0), "bat_dau_giay": c.clip_start, "ket_thuc_giay": c.clip_end, "thoi_luong_giay": c.duration_sec,
                    "sha256": c.sha256, "nguoi_cat": c.acquirer.full_name if c.acquirer else "", "thoi_diem_cat": c.acquired_at.isoformat() + "Z"}
            entries.append((f"02_doan_cat/{c.evidence_id}_{Path(c.display_name).stem}.json", json.dumps(meta, ensure_ascii=False, indent=2).encode(), None))
            if c.storage_path:
                entries.append((f"02_doan_cat/{c.evidence_id}_{c.original_file_name}", media.absolute(c.storage_path), c.sha256))
    if opt.get("images"):
        for i, s in enumerate(P["snaps"], 1):
            v = byid.get(s.video_id) if s.video_id else None
            stem = f"{i:02d}_{v.evidence_id}_{mmss(s.t).replace(':', 'm')}s" if v else f"{i:02d}_anh_tai_len"
            entries.append((f"03_anh/{stem}.jpg", media.absolute(s.image_path), s.sha256 or None))
        for df in P["derived"]:
            entries.append((f"03_anh/da_xu_ly/{df.file_name}", media.absolute(df.path), df.sha256 or None))
    if opt.get("dets"):
        rows = [["Mã", "Chứng cứ", "Loại", "Mô tả", "Biển số", "Xuất hiện từ", "Đến", "Độ tin cậy %", "Camera", "Đường đi", "Danh sách theo dõi"]]
        for d in sorted(P["dets"], key=lambda x: (byid[x.video_id].evidence_id or "", x.t_in)):
            v = byid[d.video_id]
            rows.append([d.track_id, v.evidence_id, "Người" if d.kind == DetKind.PERSON else "Phương tiện", attrs(d), d.plate_text or "",
                         local(v.recorded_start + timedelta(seconds=d.t_in)), local(v.recorded_start + timedelta(seconds=d.t_out)), round(d.confidence),
                         v.camera_id, " → ".join(p["camera_id"] for p in d.path or []), "Có" if d.watch_item_id else ""])
        entries.append(("04_ket_qua_AI/doi_tuong_nhan_dien.csv", _csv(rows), None))
        if P["zones"]:
            zrows = [["Vùng", "Chứng cứ", "Đối tượng", "Vào", "Ra", "Số giây trong vùng"]]
            for z in P["zones"]:
                for h in db.execute(select(ZoneHit).where(ZoneHit.zone_id == z.id).order_by(ZoneHit.enter_t)).scalars():
                    d = db.get(Detection, h.detection_id)
                    zrows.append([z.name, byid[z.video_id].evidence_id if z.video_id in byid else "", d.track_id if d else h.detection_id,
                                  mmss(h.enter_t), mmss(h.exit_t), max(1, round(h.exit_t - h.enter_t))])
            entries.append(("04_ket_qua_AI/vung_nhan_dien.csv", _csv(zrows), None))
    if opt.get("tags"):
        rows = [["Màu", "Ghi chú", "Chứng cứ", "Thời điểm", "Đối tượng"]]
        for t in P["tags"]:
            v = byid.get(t.video_id)
            d = db.get(Detection, t.detection_id) if t.detection_id else None
            rows.append([color_name(t.color), t.note, v.evidence_id if v else "", local(v.recorded_start + timedelta(seconds=t.t)) if v else "", d.track_id if d else ""])
        entries.append(("05_the_danh_dau/the.csv", _csv(rows), None))
    if opt.get("log"):
        rows = [["STT", "Thời điểm (GMT+7)", "Người thực hiện", "Thao tác", "Đối tượng", "Mã băm bản ghi"]]
        rows += [[r.seq, local(r.at), r.actor, action_label(r.action), r.object, r.hash] for r in P["log"]]
        entries.append(("06_nhat_ky/chuoi_luu_giu_chung_cu.csv", _csv(rows), None))
    if opt.get("report"):
        entries.append((f"BaoCao_{case.code}.html", _html_report(case, P, byid, user, now).encode(), None))

    sums = []
    for path, src, known in entries:
        if known:
            sha = known
        elif isinstance(src, bytes):
            sha = hashlib.sha256(src).hexdigest()
        else:
            from ..security import sha256_file

            sha = sha256_file(src)
        sums.append(f"{sha}  {path}")
    entries.append(("SHA256SUMS.txt", ("\n".join(sums) + "\n").encode(), None))
    readme = "\r\n".join([
        f"GÓI CHỨNG CỨ {case.code} · {case.title}", f"Tạo bởi {user.full_name} · {local(now)} (GMT+7) · Video Master AI", "",
        "Cấu trúc:", "01_video_goc    video gốc, nguyên byte như lúc tiếp nhận", "02_doan_cat     đoạn cắt (tệp video + mô tả JSON)",
        "03_anh          ảnh chụp, ảnh đã xử lý bằng AI (không phải ảnh gốc)", "04_ket_qua_AI   đối tượng nhận diện, vùng nhận diện (CSV UTF-8)",
        "05_the_danh_dau thẻ đánh dấu", "06_nhat_ky      chuỗi lưu giữ chứng cứ (mỗi dòng có mã băm nối chuỗi)", "",
        f'Kiểm tra toàn vẹn: giải nén, vào thư mục {base} và chạy "sha256sum -c SHA256SUMS.txt". Mọi dòng phải báo OK.',
        "Mã băm video gốc lúc tiếp nhận có trong báo cáo HTML và cột SHA-256 của gói.",
        "Kết quả AI là gợi ý, cần được điều tra viên xác minh với dữ liệu gốc.",
    ])
    entries.append(("README.txt", readme.encode(), None))

    with zipfile.ZipFile(dst, "w", allowZip64=True) as z:
        for path, src, _ in entries:
            arc = f"{base}/{path}"
            if isinstance(src, bytes):
                z.writestr(arc, src, compress_type=zipfile.ZIP_DEFLATED)
            else:
                z.write(src, arc, compress_type=zipfile.ZIP_STORED if src.suffix.lower() in (".mp4", ".mov", ".avi", ".mkv", ".jpg", ".png") else zipfile.ZIP_DEFLATED)
    from ..security import sha256_file

    return {"path": dst, "file_name": f"{base}.zip", "sha256": sha256_file(dst), "size": dst.stat().st_size, "files": [f"{base}/{p}" for p, _, _ in entries]}


def _html_report(case: Case, P: dict, byid: dict, user: User, now: datetime) -> str:
    e = html.escape
    rows = "".join(f"<tr><td>{e(v.evidence_id or '')}</td><td>{e(v.display_name)}</td><td>{e(v.camera_id)}</td><td>{e(SOURCE_LABEL[v.source.value][0])}</td>"
                   f"<td><code>{v.sha256 or ''}</code></td><td>{e(analysis_label(v.analysis_fps, v.analysis_modes))}</td></tr>" for v in P["roots"] + P["clips"])
    tags = "".join(f"<tr><td>{local(byid[t.video_id].recorded_start + timedelta(seconds=t.t)) if t.video_id in byid else ''}</td><td>{e(color_name(t.color))}</td><td>{e(t.note)}</td></tr>" for t in P["tags"])
    people = sum(1 for d in P["dets"] if d.kind == DetKind.PERSON)
    return f"""<!doctype html><meta charset="utf-8"><title>{e(case.code)}</title>
<style>body{{font:14px/1.5 system-ui,sans-serif;max-width:960px;margin:32px auto;padding:0 16px;color:#111}}table{{border-collapse:collapse;width:100%;margin:12px 0}}td,th{{border:1px solid #ccd;padding:6px 8px;text-align:left;font-size:13px;vertical-align:top}}th{{background:#f0f3f7}}code{{font-family:ui-monospace,monospace;font-size:11px;word-break:break-all}}</style>
<h1>{e(case.title)}</h1><p>Mã vụ án <b>{e(case.code)}</b> · Quyết định {e(case.decision_no)} · Điều tra viên {e(case.lead.full_name if case.lead else '')} · Xuất bởi {e(user.full_name)} lúc {local(now)} (GMT+7)</p>
<h2>Chứng cứ video</h2><table><tr><th>Mã</th><th>Tệp</th><th>Camera</th><th>Nguồn</th><th>SHA-256 lúc tiếp nhận</th><th>Phân tích</th></tr>{rows}</table>
<h2>Tóm tắt kết quả</h2><p>{people} người, {len(P['dets']) - people} phương tiện, {len(P['tags'])} thẻ, {len(P['zones'])} vùng nhận diện, {len(P['snaps'])} ảnh.</p>
<h2>Thẻ đánh dấu</h2><table><tr><th>Thời điểm</th><th>Màu</th><th>Ghi chú</th></tr>{tags}</table>
<p style="color:#556">Kết quả AI là gợi ý, cần được điều tra viên xác minh với dữ liệu gốc trước khi đưa vào hồ sơ.</p>"""
