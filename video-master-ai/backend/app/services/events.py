"""Realtime events and notifications.

Any process (API or worker) appends to the `events` table inside its own transaction; the API's relay
loop streams new rows to connected WebSocket clients. No extra broker is needed on-premise.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Case, Event, Notification, Role, User


def publish(db: Session, type_: str, payload: dict, user_id: str | None = None) -> None:
    db.add(Event(type=type_, payload=payload, user_id=user_id))


def notify(db: Session, user_ids: set[str], *, kind: str, tone: str, title: tuple[str, str], body: tuple[str, str] = ("", ""), link: dict | None = None) -> None:
    """UR-NOTI-01: stored per user (kept ≥ 30 days) and pushed in realtime."""
    for uid in user_ids:
        n = Notification(user_id=uid, kind=kind, tone=tone, title_vi=title[0], title_en=title[1], body_vi=body[0], body_en=body[1], link=link or {})
        db.add(n)
        db.flush()
        publish(db, "notification", {"id": n.id, "kind": kind}, user_id=uid)


def case_recipients(db: Session, case: Case, extra: set[str] | None = None) -> set[str]:
    """Lead investigator plus anyone named in `extra` (e.g. the uploader). Q02 may widen this."""
    ids = {case.lead_user_id} | (extra or set())
    return {u for u in ids if u}


def watch_recipients(db: Session, case: Case, uploader_id: str | None) -> set[str]:
    ids = case_recipients(db, case, {uploader_id} if uploader_id else set())
    users = db.execute(select(User).where(User.id.in_(ids))).scalars()
    allowed = {Role.INVESTIGATOR, Role.COMMANDER}
    return {u.id for u in users if u.role in allowed}
