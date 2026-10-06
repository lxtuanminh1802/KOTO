"""Demo data mirroring the prototype: python -m app.seed [--reset]

Footage goes through the real intake path (hash, EV code, read-only original, audit). VA-117's two videos are
analysed immediately; VA-121's video is left queued so the worker analyses it live and the watchlist plate
29A-123.45 raises an early alert while it runs.
"""

import shutil
import sys

from sqlalchemy import select

from .config import get_settings
from .db import Base, SessionLocal, engine, init_db
from .domain import DEFAULT_MODES
from .models import AnalysisJob, Camera, Case, Detection, JobStatus, Role, Tag, User, Video, VideoSource, Zone, utcnow
from .security import hash_secret
from .services.analysis import compute_zone, run_analysis
from .services.audit import audit
from .services.events import notify

PASSWORD = "VideoMaster@2026"
PIN = "123456"

USERS = [
    ("tranhai", "Trần Hải", "Điều tra viên", "PC02 Công an TP Hà Nội", Role.INVESTIGATOR, "JBSWY3DPEHPK3PXP"),
    ("phamthuha", "Phạm Thu Hà", "Điều tra viên", "PC08 Công an TP Hà Nội", Role.INVESTIGATOR, "KRSXG5CTMVRXEZLU"),
    ("nguyenvanduc", "Nguyễn Văn Đức", "Giám định viên", "Phòng Kỹ thuật hình sự", Role.EXPERT, "MFRGGZDFMZTWQ2LK"),
    ("leminh", "Lê Minh", "Thiếu tá, Chỉ huy", "PC02 Công an TP Hà Nội", Role.COMMANDER, "NBSWY3DPO5XXE3DE"),
    ("viewer", "Đỗ Quang Vinh", "Cán bộ xem hồ sơ", "PC02 Công an TP Hà Nội", Role.VIEWER, "ONSWG4TFOQ5DEMBQ"),
    ("admin", "Quản trị hệ thống", "Quản trị", "Trung tâm dữ liệu", Role.ADMIN, "MZXW6YTBOI5DGNZQ"),
]

CAMERAS = [
    ("CAM_HK_014", "Hàng Bài giao Tràng Tiền", 21.0247, 105.8536),
    ("CAM_HK_009", "Đinh Tiên Hoàng, Hồ Gươm", 21.0296, 105.8540),
    ("CAM_HK_021", "Bà Triệu giao Trần Hưng Đạo", 21.0209, 105.8496),
    ("CAM_DD_022", "Nút giao Ngã Tư Sở", 21.0030, 105.8199),
]


def ingest(db, case: Case, name: str, by: User) -> Video:
    from .demo.generate import render
    from .services.intake import finalize_upload

    s = get_settings()
    src, _, sha = render(name, s.data_dir / "demo")
    v = Video(case_id=case.id, display_name=name, original_file_name=name, size_bytes=src.stat().st_size, camera_id=name[:10], source=VideoSource.NVR,
              acquired_by=by.id, acquired_at=utcnow(), analysis_fps="5", analysis_modes=DEFAULT_MODES)
    db.add(v)
    db.flush()
    tmp = s.upload_tmp_dir / f"{v.id}.part"
    shutil.copyfile(src, tmp)
    ok, _ = finalize_upload(db, v, tmp, sha, by)
    assert ok
    return v


def analyse_now(db, v: Video) -> None:
    s = get_settings()
    job = db.execute(select(AnalysisJob).where(AnalysisJob.video_id == v.id)).scalars().first()
    job.status = JobStatus.RUNNING
    db.commit()
    old, s.sim_speed = s.sim_speed, 0
    try:
        run_analysis(job.id)
    finally:
        s.sim_speed = old
    db.expire_all()


def det(db, v: Video, track: str) -> Detection:
    return db.execute(select(Detection).where(Detection.video_id == v.id, Detection.track_id == track)).scalars().first()


def main(reset: bool) -> None:
    if reset:
        Base.metadata.drop_all(engine)
        shutil.rmtree(get_settings().evidence_dir, ignore_errors=True)
        shutil.rmtree(get_settings().derived_dir, ignore_errors=True)
        shutil.rmtree(get_settings().export_dir, ignore_errors=True)
    init_db()
    get_settings.cache_clear()
    get_settings()
    with SessionLocal() as db:
        if db.execute(select(User)).first():
            print("Database already has users; run with --reset to rebuild the demo.")
            return
        users = {}
        for uname, full, title, unit, role, secret in USERS:
            u = User(username=uname, full_name=full, title=title, unit=unit, role=role, password_hash=hash_secret(PASSWORD), pin_hash=hash_secret(PIN),
                     totp_secret=secret, totp_confirmed=True)
            db.add(u)
            users[uname] = u
        for cid, name, lat, lng in CAMERAS:
            db.add(Camera(id=cid, name=name, lat=lat, lng=lng))
        db.flush()

        c1 = Case(code="VA-117", title="Cướp giật tài sản, phố Hàng Bài", decision_no="117/QĐ-PC02", lead_user_id=users["tranhai"].id, created_by=users["tranhai"].id)
        c2 = Case(code="VA-121", title="Va chạm giao thông, nút Ngã Tư Sở", decision_no="121/QĐ-PC08", lead_user_id=users["phamthuha"].id, created_by=users["phamthuha"].id)
        db.add_all([c1, c2])
        db.flush()
        audit(db, "CASE_OPEN", "VA-117", user=users["tranhai"], case_id=c1.id)
        audit(db, "CASE_OPEN", "VA-121", user=users["phamthuha"], case_id=c2.id)

        from .api.watch import add_from_detection
        from .domain import plate_norm
        from .models import WatchItem, WatchKind

        db.add(WatchItem(kind=WatchKind.PLATE, plate_pattern="29A-123.45", plate_norm=plate_norm("29A-123.45"), note="Xe bạc nghi vấn, liên quan VA-121", created_by=users["phamthuha"].id))
        db.add(WatchItem(kind=WatchKind.PLATE, plate_pattern="51F-888.*", plate_norm=plate_norm("51F-888.*"), note="Mẫu biển số xe đen bỏ chạy (đọc chưa đủ)", created_by=users["tranhai"].id))
        audit(db, "WATCH_ADD", "Biển số: 29A-123.45", user=users["phamthuha"])
        audit(db, "WATCH_ADD", "Biển số: 51F-888.*", user=users["tranhai"])
        db.commit()

        print("Rendering and ingesting demo footage (first run takes about a minute)…")
        v1 = ingest(db, c1, "CAM_HK_014_HangBai.mp4", users["nguyenvanduc"])
        v3 = ingest(db, c1, "CAM_HK_009_HoGuom.mp4", users["nguyenvanduc"])
        db.commit()
        analyse_now(db, v1)
        analyse_now(db, v3)
        v1, v3 = db.get(Video, v1.id), db.get(Video, v3.id)

        # Face watchlist entry from the suspect's crops (three moments), as the prototype seeds it.
        add_from_detection(db, det(db, v1, "P01"), users["tranhai"])
        w = db.execute(select(WatchItem).where(WatchItem.kind == WatchKind.FACE)).scalars().first()
        w.name, w.note = "Nghi phạm cướp giật VA-117", "Nam, áo đen dài tay, ba lô"
        from .services.watch import retag_all

        retag_all(db)

        p1, p2 = det(db, v1, "P01"), det(db, v1, "P02")
        x1 = det(db, v3, "X01")
        db.add(Tag(case_id=c1.id, video_id=v1.id, detection_id=p1.id, t=p1.t_in, color="red", note="Nghi phạm: áo đen dài tay, ba lô, đi về phía Hồ Gươm", created_by=users["tranhai"].id))
        db.add(Tag(case_id=c1.id, video_id=v1.id, detection_id=p2.id, t=p2.t_in, color="gray", note="Nhân chứng tiềm năng, đứng gần cửa ATM", created_by=users["tranhai"].id))
        if x1:
            db.add(Tag(case_id=c1.id, video_id=v3.id, detection_id=x1.id, t=x1.t_in, color="yellow", note="Xe bạc 29A-123.45 xuất hiện ở hai hiện trường", created_by=users["tranhai"].id))
        audit(db, "TAG_SUBJECT", f"P01 · {v1.evidence_id} · red", user=users["tranhai"], case_id=c1.id)
        audit(db, "TAG_SUBJECT", f"P02 · {v1.evidence_id} · gray", user=users["tranhai"], case_id=c1.id)

        for code, name, vid, poly, case in [
            ("Z01", "Cửa ATM ngân hàng, Hàng Bài", v1, [[20, 30], [46, 26], [50, 80], [18, 84]], c1),
            ("Z02", "Lối thoát hiểm TTTM Tràng Tiền", v1, [[58, 20], [84, 22], [82, 70], [60, 74]], c1),
        ]:
            z = Zone(code=code, video_id=vid.id, case_id=case.id, name=name, polygon=poly, created_by=users["tranhai"].id)
            db.add(z)
            db.flush()
            n = compute_zone(db, z)
            audit(db, "ZONE_CREATE", f"{name} · {vid.evidence_id} · {n} đối tượng", user=users["tranhai"], case_id=case.id)
        db.commit()

        from .services.annotate import annotations_at, snapshot_score
        from .services import media
        from .services.vision import grab, save_jpeg
        from .models import Snapshot
        from .security import sha256_file

        for v, t in ((v3, 25.0), (v1, 24.0), (v1, 12.0)):
            img = grab(media.absolute(v.storage_path), t)
            s = Snapshot(case_id=v.case_id, video_id=v.id, t=t, image_path="", created_by=users["tranhai"].id)
            db.add(s)
            db.flush()
            s.image_path = save_jpeg(img, media.derived_path("snapshots", v.case_id, f"{s.id}.jpg"))
            s.sha256 = sha256_file(media.absolute(s.image_path))
            dets = list(db.execute(select(Detection).where(Detection.video_id == v.id, Detection.analysis_version == v.analysis_version)).scalars())
            s.annotations = annotations_at(dets, t)
            s.counts, s.score = snapshot_score(s.annotations)
            audit(db, "SNAPSHOT", f"{v.evidence_id} @ 00:{int(t):02d}", user=users["tranhai"], case_id=v.case_id)

        # VA-121: queued, analysed live by the worker (early alert on 29A-123.45).
        v2 = ingest(db, c2, "CAM_DD_022_NgaTuSo.mp4", users["phamthuha"])
        z3 = Zone(code="Z01", video_id=v2.id, case_id=c2.id, name="Vạch dừng đèn đỏ, Ngã Tư Sở", polygon=[[10, 60], [90, 58], [94, 80], [6, 84]], created_by=users["phamthuha"].id)
        db.add(z3)
        audit(db, "ZONE_CREATE", f"{z3.name} · {v2.evidence_id} · chờ phân tích video", user=users["phamthuha"], case_id=c2.id)

        notify(db, {users["tranhai"].id}, kind="shared", tone="accent", title=("Thiếu tá Lê Minh chia sẻ vụ VA-121", "Maj. Le Minh shared case VA-121"),
               body=("Quyền: xem và gắn thẻ", "Access: view and tag"), link={"case": c2.id})
        if p1 and len(p1.path or []) > 1:
            notify(db, {users["tranhai"].id}, kind="multi_camera", tone="accent", title=(f"P01 xuất hiện ở {len(p1.path)} camera", f"P01 seen on {len(p1.path)} cameras"),
                   body=("Nghi phạm VA-117: nam, áo đen dài tay, ba lô", "VA-117 suspect: male, black long sleeve, backpack"), link={"map": p1.id})
        db.commit()

    print("Demo ready. Users (password %s, PIN %s, OTP 000000 in demo mode):" % (PASSWORD, PIN))
    for uname, full, _, _, role, secret in USERS:
        print(f"  {uname:<13} {role.value:<13} {full:<20} TOTP secret {secret}")


if __name__ == "__main__":
    main("--reset" in sys.argv)
