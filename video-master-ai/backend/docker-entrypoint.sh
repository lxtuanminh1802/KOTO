#!/bin/sh
set -e
# Wait for MySQL, create tables, optionally load the demo, then run the given command (API or worker).
python - <<'PY'
import time
from sqlalchemy import text
from app.db import engine, init_db
for i in range(60):
    try:
        with engine.connect() as c:
            c.execute(text("SELECT 1"))
        break
    except Exception as e:
        print("waiting for database…", e.__class__.__name__)
        time.sleep(2)
init_db()
PY
if [ "${VMA_SEED_DEMO:-false}" = "true" ] && [ "${VMA_ROLE:-api}" = "api" ]; then
  python -m app.seed || true
fi
exec "$@"
