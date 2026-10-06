"""Notification centre (UR-NOTI-01). Kept at least 30 days."""

from fastapi import APIRouter, Depends
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Notification, User
from ..serializers import iso
from .deps import current_user

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


def out(n: Notification) -> dict:
    return {"id": n.id, "kind": n.kind, "tone": n.tone, "title_vi": n.title_vi, "title_en": n.title_en, "body_vi": n.body_vi, "body_en": n.body_en,
            "link": n.link, "unread": n.unread, "at": iso(n.created_at)}


@router.get("")
def list_notifications(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.execute(select(Notification).where(Notification.user_id == user.id).order_by(Notification.created_at.desc()).limit(100)).scalars()
    return [out(n) for n in rows]


@router.post("/{nid}/read")
def read_one(nid: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.execute(update(Notification).where(Notification.id == nid, Notification.user_id == user.id).values(unread=False))
    db.commit()
    return {"ok": True}


@router.post("/read-all")
def read_all(user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.execute(update(Notification).where(Notification.user_id == user.id).values(unread=False))
    db.commit()
    return {"ok": True}
