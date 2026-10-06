from fastapi import Depends, HTTPException, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import AuthSession, Case, User, Video, VideoState
from ..permissions import can
from ..security import decode

bearer = HTTPBearer(auto_error=False)


class ApiError(HTTPException):
    """Errors carry both languages; the UI shows the one the user picked (NFR-I18N-01)."""

    def __init__(self, status: int, code: str, vi: str, en: str | None = None, **extra):
        super().__init__(status_code=status, detail={"code": code, "vi": vi, "en": en or vi, **extra})


def _session_user(db: Session, payload: dict | None) -> User:
    if not payload:
        raise ApiError(401, "auth.expired", "Phiên đăng nhập đã hết hạn. Đăng nhập lại để tiếp tục.", "Your session expired. Sign in again.")
    sess = db.get(AuthSession, payload.get("sid"))
    from ..models import utcnow

    if not sess or sess.revoked or sess.expires_at < utcnow():
        raise ApiError(401, "auth.expired", "Phiên đăng nhập đã hết hạn. Đăng nhập lại để tiếp tục.", "Your session expired. Sign in again.")
    user = db.get(User, payload["sub"])
    if not user or not user.active:
        raise ApiError(401, "auth.inactive", "Tài khoản không còn hoạt động.", "Account is disabled.")
    user._sid = sess.id  # type: ignore[attr-defined]
    return user


def current_user(cred: HTTPAuthorizationCredentials | None = Depends(bearer), db: Session = Depends(get_db)) -> User:
    return _session_user(db, decode(cred.credentials, "access") if cred else None)


def media_user(token: str = Query(""), db: Session = Depends(get_db)) -> User:
    return _session_user(db, decode(token, "media"))


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    return (fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else ""))[:64]


def require(user: User, action: str, case: Case | None = None) -> None:
    if not can(user, action, case):
        if case is not None and case.status.value == "CLOSED" and can(user, action):
            raise ApiError(403, "case.closed", "Vụ án đã kết thúc, chỉ được xem và xuất gói.", "The case is closed: view and export only.")
        raise ApiError(403, "forbidden", "Bạn không có quyền thực hiện thao tác này.", "You are not allowed to do this.")


def get_case(db: Session, case_id: str) -> Case:
    c = db.get(Case, case_id)
    if not c:
        raise ApiError(404, "case.not_found", "Không tìm thấy vụ án.", "Case not found.")
    return c


def get_video(db: Session, video_id: str, include_removed: bool = False) -> Video:
    v = db.get(Video, video_id)
    if not v or (not include_removed and (v.deleted_at or v.state == VideoState.REMOVED)):
        raise ApiError(404, "video.not_found", "Không tìm thấy video.", "Video not found.")
    return v
