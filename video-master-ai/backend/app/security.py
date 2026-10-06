import hashlib
import re
from datetime import datetime, timedelta

import bcrypt
import jwt
import pyotp

from .config import get_settings

PASSWORD_RE = re.compile(r"^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{12,}$")


def hash_secret(raw: str) -> str:
    return bcrypt.hashpw(raw.encode(), bcrypt.gensalt(rounds=10)).decode()


def verify_secret(raw: str, hashed: str | None) -> bool:
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(raw.encode(), hashed.encode())
    except ValueError:
        return False


def password_ok(pw: str) -> bool:
    """UR-AUTH-01: at least 12 chars with upper, lower and a digit."""
    return bool(PASSWORD_RE.match(pw))


def verify_otp(secret: str | None, code: str) -> bool:
    s = get_settings()
    if s.demo_mode and code == "000000":
        return True
    if not secret:
        return False
    return pyotp.TOTP(secret).verify(code, valid_window=1)


def new_totp_secret() -> str:
    return pyotp.random_base32()


def totp_uri(secret: str, username: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=username, issuer_name="Video Master AI")


def _encode(payload: dict, ttl: timedelta) -> str:
    s = get_settings()
    now = datetime.utcnow()
    return jwt.encode({**payload, "iat": now, "exp": now + ttl}, s.jwt_secret, algorithm="HS256")


def access_token(user_id: str, session_id: str) -> str:
    return _encode({"sub": user_id, "sid": session_id, "typ": "access"}, timedelta(minutes=get_settings().access_ttl_minutes))


def refresh_token(user_id: str, session_id: str, expires_at: datetime) -> str:
    return _encode({"sub": user_id, "sid": session_id, "typ": "refresh"}, expires_at - datetime.utcnow())


def media_token(user_id: str, session_id: str) -> str:
    """Query-string token for <video>/<img> sources, which cannot send an Authorization header."""
    return _encode({"sub": user_id, "sid": session_id, "typ": "media"}, timedelta(hours=get_settings().media_ttl_hours))


def pending_token(user_id: str) -> str:
    """Issued after a correct password, exchanged for a session once the OTP is verified."""
    return _encode({"sub": user_id, "typ": "pending"}, timedelta(minutes=5))


def decode(token: str, typ: str) -> dict | None:
    try:
        data = jwt.decode(token, get_settings().jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    return data if data.get("typ") == typ else None


def sha256_file(path, chunk: int = 4 * 1024 * 1024) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while b := f.read(chunk):
            h.update(b)
    return h.hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
