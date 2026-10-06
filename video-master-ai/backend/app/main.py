import asyncio
import logging
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .db import init_db

log = logging.getLogger("vma")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    from .api.realtime import hub

    relay = asyncio.create_task(hub.relay_loop())
    if get_settings().worker_embedded:
        from .worker import run_forever

        threading.Thread(target=run_forever, args=("embedded",), daemon=True).start()
    yield
    relay.cancel()


app = FastAPI(title="Video Master AI", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in get_settings().cors_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from .api import admin, assistant, auth, cameras, cases, exports, images, media, notifications, realtime, search, tags, uploads, videos, watch, zones  # noqa: E402

for r in (auth.router, auth.me_router, cases.router, uploads.router, videos.router, media.router, search.router, zones.router, tags.router,
          watch.router, cameras.router, images.router, exports.router, notifications.router, assistant.router, admin.router, realtime.router):
    app.include_router(r)


@app.get("/api/health")
def health():
    s = get_settings()
    return {"ok": True, "engine": s.ai_engine, "demo_mode": s.demo_mode, "maptiler_key": s.maptiler_key}
