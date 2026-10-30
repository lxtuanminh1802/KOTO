"""Đầu ra: ghi file JSON và/hoặc đẩy lên API của phần mềm quản lý."""

from __future__ import annotations

import json
import logging
from pathlib import Path

import requests

log = logging.getLogger(__name__)


def write_json(path: Path, source: dict, items: list[dict]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"source": source, "count": len(items), "items": items}, ensure_ascii=False, indent=2),
                    encoding="utf-8")
    return path


def push(api_url: str, token: str | None, source: dict, items: list[dict], batch: int = 50, timeout: int = 30) -> dict:
    """POST {source, items} theo lô. Server tự loại trùng theo domain và trả về số bản ghi mới/trùng."""
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    total = {"created": 0, "duplicates": 0, "errors": 0}
    for i in range(0, len(items), batch):
        chunk = items[i:i + batch]
        try:
            r = requests.post(api_url, headers=headers, timeout=timeout,
                              data=json.dumps({"source": source, "items": chunk}, ensure_ascii=False).encode("utf-8"))
            r.raise_for_status()
            body = r.json() if r.content else {}
            total["created"] += int(body.get("created", len(chunk)))
            total["duplicates"] += int(body.get("duplicates", 0))
        except (requests.RequestException, ValueError) as e:
            log.error("Đẩy lô %d–%d thất bại: %s", i, i + len(chunk), e)
            total["errors"] += len(chunk)
    return total
