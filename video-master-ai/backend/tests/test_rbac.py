from app.models import Case, CaseStatus, Role, User
from app.permissions import can, permissions_for


def _u(uid, role):
    return User(id=uid, username=uid, full_name=uid, role=role, password_hash="x")


LEAD = _u("lead", Role.INVESTIGATOR)
OTHER = _u("other", Role.INVESTIGATOR)
EXPERT = _u("exp", Role.EXPERT)
CMD = _u("cmd", Role.COMMANDER)
VIEWER = _u("view", Role.VIEWER)
ADMIN = _u("adm", Role.ADMIN)


def _case(status=CaseStatus.ACTIVE):
    return Case(id="c1", code="VA-117", title="t", lead_user_id=LEAD.id, created_by=LEAD.id, status=status)


def test_lead_only_actions():
    c = _case()
    assert can(LEAD, "case.edit", c) and can(LEAD, "package", c)
    assert not can(OTHER, "case.edit", c) and not can(OTHER, "package", c)
    assert can(OTHER, "video.upload", c)


def test_viewer_is_read_only():
    c = _case()
    assert can(VIEWER, "video.view", c) and can(VIEWER, "search", c)
    for a in ("video.upload", "video.edit", "tag", "zone", "report.pdf", "search.face", "watch.manage"):
        assert not can(VIEWER, a, c), a


def test_admin_sees_metadata_but_not_footage():
    c = _case()
    assert can(ADMIN, "case.meta", c) and can(ADMIN, "admin")
    assert not can(ADMIN, "video.view", c)


def test_closed_case_blocks_writes():
    c = _case(CaseStatus.CLOSED)
    assert not can(LEAD, "video.upload", c)
    assert not can(EXPERT, "tag", c)
    assert can(LEAD, "video.view", c) and can(CMD, "report.pdf", c)


def test_only_commander_closes():
    c = _case()
    assert can(CMD, "case.close", c)
    assert not can(LEAD, "case.close", c)
    assert "case.close" not in permissions_for(LEAD)
