"""Chain-of-custody log (UR-AUD-01). Append-only; each row stores the hash of the previous one (NFR-SEC-03).

Writers serialize on a single head row so the chain stays linear even with several API and worker processes.
"""

import hashlib
import json
from datetime import datetime

from sqlalchemy import String, select
from sqlalchemy.orm import Mapped, Session, mapped_column

from ..db import Base
from ..models import AuditLog, User, utcnow

GENESIS = "0" * 64
SYSTEM_ACTOR = "Hệ thống"

# Event catalogue: code -> (Vietnamese, English). Codes are stored; labels are rendered by the UI and exports.
ACTIONS: dict[str, tuple[str, str]] = {
    "LOGIN_OK": ("Đăng nhập thành công", "Signed in"),
    "LOGIN_FAIL": ("Đăng nhập thất bại", "Failed sign-in"),
    "LOGIN_LOCKED": ("Tài khoản tạm khóa", "Account locked"),
    "LOGOUT": ("Đăng xuất", "Signed out"),
    "SESSION_LOCK": ("Khóa phiên", "Locked session"),
    "SESSION_UNLOCK": ("Mở khóa phiên", "Unlocked session"),
    "SESSION_PIN_FAIL": ("Nhập sai PIN", "Wrong PIN"),
    "CASE_OPEN": ("Mở hồ sơ vụ án", "Opened case"),
    "CASE_UPDATE": ("Cập nhật vụ án", "Updated case"),
    "EVIDENCE_INGEST": ("Nhập chứng cứ", "Ingested evidence"),
    "EVIDENCE_HASH": ("Tính mã băm SHA-256", "Computed SHA-256"),
    "EVIDENCE_REJECT": ("Lỗi toàn vẹn khi tiếp nhận", "Integrity failure at intake"),
    "EVIDENCE_VERIFY_OK": ("Xác minh SHA-256 khớp", "SHA-256 verified"),
    "EVIDENCE_VERIFY_FAIL": ("Phát hiện lệch mã băm", "Hash mismatch detected"),
    "ANALYSIS_QUEUE": ("Đưa vào hàng đợi phân tích", "Queued for analysis"),
    "ANALYSIS_DONE": ("Hoàn tất phân tích AI", "AI analysis complete"),
    "ANALYSIS_FAIL": ("Phân tích AI lỗi", "AI analysis failed"),
    "ANALYSIS_REQUEUE": ("Yêu cầu phân tích lại", "Requested re-analysis"),
    "EVIDENCE_REMOVE": ("Gỡ chứng cứ khỏi vụ án", "Removed evidence from case"),
    "VIDEO_RENAME": ("Đổi tên hiển thị video", "Renamed video"),
    "CLIP_CREATE": ("Cắt đoạn video", "Cut clip"),
    "SNAPSHOT": ("Chụp khung hình", "Captured frame"),
    "BOOKMARK": ("Đánh dấu thời điểm", "Bookmarked moment"),
    "TAG_SUBJECT": ("Gắn thẻ đối tượng", "Tagged subject"),
    "TAG_DELETE": ("Xóa thẻ", "Deleted tag"),
    "IMAGE_EXPORT": ("Xuất ảnh", "Exported image"),
    "IMAGE_TO_REPORT": ("Chèn ảnh vào báo cáo", "Inserted image into report"),
    "VIDEO_ENHANCE": ("Xuất video đã cải thiện", "Exported enhanced video"),
    "REPORT_PDF": ("Tạo báo cáo PDF", "Generated PDF report"),
    "PACKAGE_EXPORT": ("Xuất gói chứng cứ", "Exported evidence package"),
    "PACKAGE_BLOCKED": ("Chặn xuất gói do lệch mã băm", "Package blocked by hash mismatch"),
    "ZONE_CREATE": ("Tạo vùng nhận diện", "Created zone"),
    "ZONE_DELETE": ("Xóa vùng nhận diện", "Deleted zone"),
    "WATCH_ADD": ("Thêm vào danh sách theo dõi", "Added to watchlist"),
    "WATCH_REMOVE": ("Xóa khỏi danh sách theo dõi", "Removed from watchlist"),
    "WATCH_ALERT": ("Cảnh báo danh sách theo dõi", "Watchlist alert"),
    "SEARCH_FACE": ("Tìm theo ảnh khuôn mặt", "Face photo search"),
    "SEARCH_PLATE": ("Tìm theo biển số", "Plate search"),
    "CAMERA_ADD": ("Thêm camera", "Added camera"),
    "CAMERA_ASSIGN": ("Gán vị trí camera cho chứng cứ", "Assigned camera location"),
    "CAMERA_MOVE": ("Chỉnh vị trí camera", "Moved camera"),
    "SETTINGS_CHANGE": ("Đổi cài đặt phân tích", "Changed analysis settings"),
    "AI_QUESTION": ("Hỏi trợ lý AI", "Asked AI assistant"),
    "USER_ADMIN": ("Quản trị người dùng", "User administration"),
    "AUDIT_CHAIN_OK": ("Kiểm tra chuỗi nhật ký: hợp lệ", "Audit chain verified"),
    "AUDIT_CHAIN_BROKEN": ("Kiểm tra chuỗi nhật ký: bị sửa đổi", "Audit chain broken"),
}


class AuditHead(Base):
    __tablename__ = "audit_head"
    id: Mapped[int] = mapped_column(primary_key=True)
    last_hash: Mapped[str] = mapped_column(String(64))


def _digest(prev: str, at: datetime, user_id: str | None, actor: str, action: str, obj: str, case_id: str | None, details: dict) -> str:
    body = "|".join([prev, at.isoformat(), user_id or "", actor, action, obj, case_id or "", json.dumps(details, sort_keys=True, ensure_ascii=False)])
    return hashlib.sha256(body.encode()).hexdigest()


def audit(db: Session, action: str, obj: str = "", *, user: User | None = None, case_id: str | None = None, details: dict | None = None, ip: str = "") -> AuditLog:
    assert action in ACTIONS, action
    head = db.execute(select(AuditHead).where(AuditHead.id == 1).with_for_update()).scalar_one_or_none()
    if head is None:
        head = AuditHead(id=1, last_hash=GENESIS)
        db.add(head)
        db.flush()
    at = utcnow()
    actor = user.full_name if user else SYSTEM_ACTOR
    details = details or {}
    h = _digest(head.last_hash, at, user.id if user else None, actor, action, obj[:1000], case_id, details)
    row = AuditLog(at=at, user_id=user.id if user else None, actor=actor, action=action, object=obj[:1000], case_id=case_id, ip=ip, details=details, prev_hash=head.last_hash, hash=h)
    db.add(row)
    head.last_hash = h
    db.flush()
    from .events import publish  # local import: events imports models only

    publish(db, "audit", {"case_id": case_id})
    return row


def verify_chain(db: Session) -> tuple[bool, int | None, int]:
    """Recompute every hash in order. Returns (ok, first_bad_seq, rows_checked)."""
    prev = GENESIS
    n = 0
    for row in db.execute(select(AuditLog).order_by(AuditLog.seq)).scalars():
        n += 1
        expect = _digest(prev, row.at, row.user_id, row.actor, row.action, row.object, row.case_id, row.details or {})
        if row.prev_hash != prev or row.hash != expect:
            return False, row.seq, n
        prev = row.hash
    return True, None, n


def label(action: str, lang: str = "vi") -> str:
    vi, en = ACTIONS.get(action, (action, action))
    return vi if lang == "vi" else en
