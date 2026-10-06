from sqlalchemy import select

from app.models import AuditLog, Case, Role, User
from app.services.audit import audit, verify_chain
from app.services.intake import next_evidence_id


def _user(db):
    u = User(username="u1", full_name="Trần Hải", role=Role.INVESTIGATOR, password_hash="x")
    db.add(u)
    db.flush()
    return u


def test_chain_valid_then_tamper_detected(db):
    u = _user(db)
    for i in range(5):
        audit(db, "LOGIN_OK", f"lần {i}", user=u, details={"i": i})
    db.flush()
    ok, bad, n = verify_chain(db)
    assert ok and bad is None and n == 5

    row = db.execute(select(AuditLog).order_by(AuditLog.seq).offset(2)).scalars().first()
    row.object = "đã sửa"
    db.flush()
    ok, bad, _ = verify_chain(db)
    assert not ok and bad == row.seq


def test_deleted_row_breaks_chain(db):
    u = _user(db)
    for i in range(3):
        audit(db, "LOGIN_OK", str(i), user=u)
    db.flush()
    first = db.execute(select(AuditLog).order_by(AuditLog.seq)).scalars().first()
    db.delete(first)
    db.flush()
    assert verify_chain(db)[0] is False


def test_evidence_ids_never_reused():
    c = Case(code="VA-117", title="t", lead_user_id="x", created_by="x", ev_seq=0)
    assert [next_evidence_id(c) for _ in range(3)] == ["EV-117-01", "EV-117-02", "EV-117-03"]
    c.ev_seq = 99
    assert next_evidence_id(c) == "EV-117-100"
