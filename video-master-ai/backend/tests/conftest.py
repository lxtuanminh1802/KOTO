"""Unit tests run on an in-memory SQLite database unless VMA_TEST_DATABASE_URL points at MySQL."""

import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("VMA_DATABASE_URL", os.environ.get("VMA_TEST_DATABASE_URL", "sqlite://"))


@pytest.fixture()
def db():
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool

    from app import models  # noqa: F401  (register tables)
    from app.db import Base
    from app.services import audit  # noqa: F401  (audit_head table)

    url = os.environ["VMA_DATABASE_URL"]
    engine = create_engine(url, poolclass=StaticPool, connect_args={"check_same_thread": False}) if url.startswith("sqlite") else create_engine(url)
    Base.metadata.create_all(engine)
    s = sessionmaker(engine, expire_on_commit=False)()
    try:
        yield s
    finally:
        s.rollback()
        s.close()
        if url.startswith("sqlite"):
            Base.metadata.drop_all(engine)
