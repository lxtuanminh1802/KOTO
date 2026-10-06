"""WebSocket relay for progress, early alerts and notifications (UR-ANA-01, UR-WATCH-04, NFR-PERF-03)."""

import asyncio
import logging
from datetime import timedelta

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import delete, func, select

from ..db import SessionLocal
from ..models import AuthSession, Event, utcnow
from ..security import decode

router = APIRouter()
log = logging.getLogger("vma.realtime")


class Hub:
    def __init__(self) -> None:
        self.clients: dict[WebSocket, str] = {}
        self.last_id = 0

    def _fetch(self) -> list[Event]:
        with SessionLocal() as db:
            if not self.last_id:
                self.last_id = db.execute(select(func.max(Event.id))).scalar() or 0
                return []
            rows = list(db.execute(select(Event).where(Event.id > self.last_id).order_by(Event.id).limit(500)).scalars())
            if rows:
                self.last_id = rows[-1].id
            return rows

    def _cleanup(self) -> None:
        with SessionLocal() as db:
            db.execute(delete(Event).where(Event.created_at < utcnow() - timedelta(days=1)))
            db.commit()

    async def relay_loop(self) -> None:
        ticks = 0
        while True:
            try:
                rows = await asyncio.to_thread(self._fetch)
                for ev in rows:
                    msg = {"type": ev.type, **ev.payload}
                    for ws, uid in list(self.clients.items()):
                        if ev.user_id is None or ev.user_id == uid:
                            try:
                                await ws.send_json(msg)
                            except Exception:
                                self.clients.pop(ws, None)
                ticks += 1
                if ticks % 7200 == 0:
                    await asyncio.to_thread(self._cleanup)
            except asyncio.CancelledError:
                raise
            except Exception as e:  # keep relaying even if the DB blips
                log.warning("relay error: %s", e)
            await asyncio.sleep(0.5)


hub = Hub()


@router.websocket("/api/ws")
async def ws_endpoint(ws: WebSocket, token: str = ""):
    data = decode(token, "media") or decode(token, "access")
    ok = False
    if data:
        with SessionLocal() as db:
            sess = db.get(AuthSession, data.get("sid"))
            ok = bool(sess and not sess.revoked and sess.expires_at > utcnow())
    if not ok:
        await ws.close(code=4401)
        return
    await ws.accept()
    hub.clients[ws] = data["sub"]
    try:
        while True:
            await ws.receive_text()  # pings from the client keep proxies from idling the socket
    except WebSocketDisconnect:
        pass
    finally:
        hub.clients.pop(ws, None)
