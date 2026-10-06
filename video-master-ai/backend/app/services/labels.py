"""Human-readable subject labels used in notes, the assistant, CSV and PDF exports."""

from ..domain import color_name
from ..models import Detection, DetKind

VTYPE = {"car": ("Ô tô", "Car"), "suv": ("SUV", "SUV"), "motorbike": ("Xe máy", "Motorbike"), "truck": ("Xe tải", "Truck")}
BOTTOM = {"pants": ("quần dài", "trousers"), "shorts": ("quần short", "shorts"), "skirt": ("váy", "skirt")}


def label(d: Detection, lang: str = "vi") -> str:
    i = 0 if lang == "vi" else 1
    if d.kind == DetKind.PERSON:
        return f"{('Người', 'Person')[i]} {d.track_id}"
    vt = VTYPE.get((d.attributes or {}).get("vehicle_type", "car"), VTYPE["car"])[i]
    return f"{vt} {d.plate_text or d.track_id}"


def attrs(d: Detection, lang: str = "vi") -> str:
    a, i = d.attributes or {}, 0 if lang == "vi" else 1
    if d.kind == DetKind.VEHICLE:
        vt = VTYPE.get(a.get("vehicle_type", "car"), VTYPE["car"])[i]
        return f"{vt} {color_name(a['color'], lang)}" if a.get("color") else vt
    parts = []
    if a.get("gender"):
        parts.append(("nam", "male")[i] if a["gender"] == "m" else ("nữ", "female")[i])
    if a.get("top_color"):
        parts.append(f"{('áo', 'top')[i]} {color_name(a['top_color'], lang)}" + ((" dài tay", " long sleeve")[i] if a.get("top") == "long" else ""))
    if a.get("bottom"):
        parts.append(f"{BOTTOM[a['bottom']][i]} {color_name(a.get('bottom_color', ''), lang)}".strip())
    if a.get("mask"):
        parts.append(("đeo khẩu trang", "masked")[i])
    if "bag" in (a.get("accessories") or []):
        parts.append(("ba lô", "bag")[i])
    if "hat" in (a.get("accessories") or []):
        parts.append(("mũ", "hat")[i])
    return ", ".join(parts)


def mmss(sec: float) -> str:
    s = max(0, int(sec))
    return f"{s // 60:02d}:{s % 60:02d}"
