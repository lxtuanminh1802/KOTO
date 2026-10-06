"""System administration: users and audit-chain verification (Phân quyền: Quản trị hệ thống)."""

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Role, User
from ..security import hash_secret, password_ok
from ..serializers import user_out
from ..services.audit import audit, verify_chain
from .deps import ApiError, client_ip, current_user, require

router = APIRouter(prefix="/api/admin", tags=["admin"])


class UserIn(BaseModel):
    username: str
    full_name: str
    title: str = ""
    unit: str = ""
    role: Role = Role.INVESTIGATOR
    password: str
    pin: str = ""


class UserPatch(BaseModel):
    full_name: str | None = None
    title: str | None = None
    unit: str | None = None
    role: Role | None = None
    active: bool | None = None
    password: str | None = None
    reset_2fa: bool = False
    unlock: bool = False


@router.get("/users")
def users(user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "admin")
    return [user_out(u) | {"active": u.active, "totp_confirmed": u.totp_confirmed, "locked_until": u.locked_until.isoformat() + "Z" if u.locked_until else None}
            for u in db.execute(select(User).order_by(User.username)).scalars()]


@router.post("/users")
def create_user(body: UserIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "admin")
    uname = body.username.strip().lower()
    if db.execute(select(User).where(User.username == uname)).first():
        raise ApiError(422, "user.exists", "Tên đăng nhập đã tồn tại.", "Username already exists.")
    if not password_ok(body.password):
        raise ApiError(422, "user.password", "Mật khẩu tối thiểu 12 ký tự, có chữ hoa, chữ thường, số.", "Password needs 12+ chars with upper, lower and a digit.")
    u = User(username=uname, full_name=body.full_name.strip(), title=body.title, unit=body.unit, role=body.role, password_hash=hash_secret(body.password),
             pin_hash=hash_secret(body.pin) if body.pin else None)
    db.add(u)
    audit(db, "USER_ADMIN", f"Tạo tài khoản {uname} ({body.role.value})", user=user, ip=client_ip(request))
    db.commit()
    return user_out(u)


@router.patch("/users/{uid}")
def patch_user(uid: str, body: UserPatch, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "admin")
    u = db.get(User, uid)
    if not u:
        raise ApiError(404, "user.not_found", "Không tìm thấy tài khoản.", "User not found.")
    notes = []
    for f in ("full_name", "title", "unit", "role", "active"):
        val = getattr(body, f)
        if val is not None and val != getattr(u, f):
            setattr(u, f, val)
            notes.append(f)
    if body.password:
        if not password_ok(body.password):
            raise ApiError(422, "user.password", "Mật khẩu tối thiểu 12 ký tự, có chữ hoa, chữ thường, số.", "Password needs 12+ chars with upper, lower and a digit.")
        u.password_hash = hash_secret(body.password)
        notes.append("password")
    if body.reset_2fa:
        u.totp_secret, u.totp_confirmed = None, False
        notes.append("2fa")
    if body.unlock:
        u.locked_until, u.failed_logins = None, 0
        notes.append("unlock")
    audit(db, "USER_ADMIN", f"Cập nhật {u.username}: {', '.join(notes) or 'không đổi'}", user=user, ip=client_ip(request))
    db.commit()
    return user_out(u)


@router.get("/audit/verify")
def verify(user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "audit.view")
    ok, bad, n = verify_chain(db)
    return {"ok": ok, "first_bad_seq": bad, "rows": n}
