"""UR-AUTH-01..03: password + OTP sign-in, lockout, 8 h sessions with 15 min access tokens, PIN session lock."""

import re
from datetime import timedelta

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..models import AuthSession, User, utcnow
from ..security import access_token, decode, media_token, new_totp_secret, pending_token, refresh_token, totp_uri, verify_otp, verify_secret, hash_secret
from ..serializers import DEFAULT_USER_SETTINGS, user_out, user_settings
from ..services.audit import audit
from .deps import ApiError, client_ip, current_user

router = APIRouter(prefix="/api/auth", tags=["auth"])
me_router = APIRouter(prefix="/api/me", tags=["me"])


class LoginIn(BaseModel):
    username: str
    password: str


class OtpIn(BaseModel):
    pending: str
    code: str


class RefreshIn(BaseModel):
    refresh: str


class PinIn(BaseModel):
    pin: str


class SetPinIn(BaseModel):
    password: str
    pin: str


def _locked_error(user: User):
    mins = max(1, int((user.locked_until - utcnow()).total_seconds() // 60) + 1)
    raise ApiError(423, "auth.locked", f"Tài khoản tạm khóa 15 phút. Thử lại sau {mins} phút.", f"Account locked for 15 minutes. Try again in {mins} min.")


def _register_failure(db: Session, user: User | None, ip: str, why: str) -> None:
    s = get_settings()
    if user:
        user.failed_logins += 1
        if user.failed_logins >= s.login_max_failures:
            user.locked_until = utcnow() + timedelta(minutes=s.login_lock_minutes)
            user.failed_logins = 0
            audit(db, "LOGIN_LOCKED", user.username, ip=ip, details={"reason": why})
    audit(db, "LOGIN_FAIL", user.username if user else "?", ip=ip, details={"reason": why})
    db.commit()


@router.post("/login")
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    ip = client_ip(request)
    user = db.query(User).filter(User.username == body.username.strip().lower()).one_or_none()
    if user and user.locked_until and user.locked_until > utcnow():
        _locked_error(user)
    if not user or not user.active or not verify_secret(body.password, user.password_hash):
        _register_failure(db, user, ip, "password")
        if user and user.locked_until and user.locked_until > utcnow():
            _locked_error(user)
        raise ApiError(401, "auth.bad_credentials", "Sai tên đăng nhập hoặc mật khẩu.", "Wrong username or password.")
    out = {"pending": pending_token(user.id), "user": {"full_name": user.full_name}}
    if not user.totp_confirmed:
        if not user.totp_secret:
            user.totp_secret = new_totp_secret()
            db.commit()
        out["enroll"] = {"secret": user.totp_secret, "uri": totp_uri(user.totp_secret, user.username)}
    return out


def _issue(db: Session, user: User, request: Request) -> dict:
    s = get_settings()
    sess = AuthSession(user_id=user.id, expires_at=utcnow() + timedelta(hours=s.session_ttl_hours), ip=client_ip(request), user_agent=request.headers.get("user-agent", "")[:255])
    db.add(sess)
    db.flush()
    return {
        "access": access_token(user.id, sess.id), "refresh": refresh_token(user.id, sess.id, sess.expires_at),
        "media": media_token(user.id, sess.id), "expires_at": sess.expires_at.isoformat() + "Z", "user": user_out(user, full=True),
    }


@router.post("/otp")
def otp(body: OtpIn, request: Request, db: Session = Depends(get_db)):
    ip = client_ip(request)
    data = decode(body.pending, "pending")
    if not data:
        raise ApiError(401, "auth.pending_expired", "Hết thời gian nhập mã. Đăng nhập lại.", "The sign-in step expired. Start again.")
    user = db.get(User, data["sub"])
    if user.locked_until and user.locked_until > utcnow():
        _locked_error(user)
    if not re.fullmatch(r"\d{6}", body.code.strip()) or not verify_otp(user.totp_secret, body.code.strip()):
        _register_failure(db, user, ip, "otp")
        if user.locked_until and user.locked_until > utcnow():
            _locked_error(user)
        raise ApiError(401, "auth.bad_otp", "Mã xác thực không đúng.", "Wrong verification code.")
    user.failed_logins = 0
    user.totp_confirmed = True
    out = _issue(db, user, request)
    audit(db, "LOGIN_OK", user.username, user=user, ip=ip, details={"user_agent": request.headers.get("user-agent", "")[:120]})
    db.commit()
    return out


@router.post("/refresh")
def refresh(body: RefreshIn, db: Session = Depends(get_db)):
    data = decode(body.refresh, "refresh")
    sess = db.get(AuthSession, data["sid"]) if data else None
    if not sess or sess.revoked or sess.expires_at < utcnow():
        raise ApiError(401, "auth.expired", "Phiên đăng nhập đã hết hạn. Đăng nhập lại để tiếp tục.", "Your session expired. Sign in again.")
    return {"access": access_token(sess.user_id, sess.id), "media": media_token(sess.user_id, sess.id)}


@router.post("/logout")
def logout(request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.query(AuthSession).filter(AuthSession.id == user._sid).update({"revoked": True})
    audit(db, "LOGOUT", user.username, user=user, ip=client_ip(request))
    db.commit()
    return {"ok": True}


@router.get("/me")
def me(user: User = Depends(current_user)):
    return user_out(user, full=True)


@router.post("/lock")
def lock(request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    audit(db, "SESSION_LOCK", user.username, user=user, ip=client_ip(request))
    db.commit()
    return {"ok": True}


@router.post("/unlock")
def unlock(body: PinIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not re.fullmatch(r"\d{6}", body.pin):
        raise ApiError(400, "pin.format", "Mã PIN gồm đúng 6 chữ số", "PIN must be exactly 6 digits")
    if not verify_secret(body.pin, user.pin_hash):
        user.pin_failures += 1
        audit(db, "SESSION_PIN_FAIL", user.username, user=user, ip=client_ip(request), details={"failures": user.pin_failures})
        if user.pin_failures >= get_settings().pin_max_failures:
            user.pin_failures = 0
            db.query(AuthSession).filter(AuthSession.id == user._sid).update({"revoked": True})
            audit(db, "LOGOUT", f"{user.username} (sai PIN 5 lần)", user=user, ip=client_ip(request))
            db.commit()
            raise ApiError(401, "pin.forced_logout", "Sai PIN 5 lần. Bạn đã bị đăng xuất.", "Wrong PIN 5 times. You have been signed out.")
        db.commit()
        left = get_settings().pin_max_failures - user.pin_failures
        raise ApiError(400, "pin.wrong", f"Mã PIN không đúng. Còn {left} lần thử.", f"Wrong PIN. {left} attempts left.")
    user.pin_failures = 0
    audit(db, "SESSION_UNLOCK", user.username, user=user, ip=client_ip(request))
    db.commit()
    return {"ok": True}


@me_router.put("/pin")
def set_pin(body: SetPinIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not verify_secret(body.password, user.password_hash):
        raise ApiError(400, "auth.bad_password", "Mật khẩu không đúng.", "Wrong password.")
    if not re.fullmatch(r"\d{6}", body.pin):
        raise ApiError(400, "pin.format", "Mã PIN gồm đúng 6 chữ số", "PIN must be exactly 6 digits")
    user.pin_hash = hash_secret(body.pin)
    db.commit()
    return {"ok": True}


ANALYSIS_KEYS = {"min_conf", "watermark", "auto_redact", "notify"}


@me_router.put("/settings")
def update_settings(body: dict, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    cur = user_settings(user)
    new = dict(cur)
    for k, v in body.items():
        if k not in DEFAULT_USER_SETTINGS:
            continue
        if k == "min_conf":
            v = max(50, min(99, int(v)))
        elif k == "idle_lock_minutes":
            v = max(5, min(60, int(v)))
        elif k == "theme":
            v = "dark" if v == "dark" else "light"
        elif k == "lang":
            v = "en" if v == "en" else "vi"
        else:
            v = bool(v)
        new[k] = v
    changed = {k: new[k] for k in ANALYSIS_KEYS if new[k] != cur[k]}
    user.settings = new
    if changed:
        audit(db, "SETTINGS_CHANGE", ", ".join(f"{k}={v}" for k, v in changed.items()), user=user, ip=client_ip(request), details=changed)
    db.commit()
    return new


@me_router.post("/welcome-seen")
def welcome_seen(user: User = Depends(current_user), db: Session = Depends(get_db)):
    user.welcome_seen = True
    db.commit()
    return {"ok": True}
