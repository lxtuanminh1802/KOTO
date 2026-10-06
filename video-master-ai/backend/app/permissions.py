"""RBAC matrix from the URD sheet "Phân quyền", checked at the API (NFR-SEC-01).

"LEAD" means an investigator who is the lead (phụ trách) of the case in question.
"""

from .models import Case, CaseStatus, Role, User

INV, EXP, CMD, VIEW, ADM, LEAD = Role.INVESTIGATOR, Role.EXPERT, Role.COMMANDER, Role.VIEWER, Role.ADMIN, "LEAD"

MATRIX: dict[str, set] = {
    "case.create": {INV, LEAD, CMD},
    "case.edit": {LEAD, CMD},
    "case.close": {CMD},
    "video.upload": {INV, LEAD, EXP},
    "evidence.remove": {LEAD, CMD},
    "video.view": {INV, LEAD, EXP, CMD, VIEW},
    "case.meta": {INV, LEAD, EXP, CMD, VIEW, ADM},
    "video.edit": {INV, LEAD, EXP},  # cut, snapshot, enhance, rename
    "search": {INV, LEAD, EXP, CMD, VIEW},
    "search.face": {INV, LEAD, EXP, CMD},
    "zone": {INV, LEAD, EXP},
    "tag": {INV, LEAD, EXP},
    "watch.manage": {INV, LEAD, CMD},
    "watch.receive": {INV, LEAD, CMD},
    "camera": {INV, LEAD, EXP, ADM},
    "report.pdf": {INV, LEAD, EXP, CMD},
    "package": {LEAD, EXP, CMD},
    "audit.view": {INV, LEAD, EXP, CMD, ADM},
    "admin": {ADM},
}

# Actions that change evidence and are therefore blocked on a closed case (UR-CASE-07).
WRITE_ACTIONS = {"video.upload", "video.edit", "zone", "tag"}


def can(user: User, action: str, case: Case | None = None) -> bool:
    allowed = MATRIX.get(action, set())
    ok = user.role in allowed
    if not ok and LEAD in allowed and user.role == INV:
        # A case-independent check (e.g. menu visibility) passes if the user could lead some case.
        ok = case is None or case.lead_user_id == user.id
    if ok and case is not None and action in WRITE_ACTIONS and case.status == CaseStatus.CLOSED:
        return False
    return ok


def permissions_for(user: User) -> list[str]:
    return [a for a in MATRIX if can(user, a)]
