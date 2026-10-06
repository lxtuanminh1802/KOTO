"""Shared vocabularies: colour palette, FPS options, analysis modes, plate rules."""

import re

# UR-ANA-02: 14 standard colours.
COLORS: dict[str, dict] = {
    "white": {"hex": "#F8FAFC", "vi": "trắng", "en": "white", "rgb": (245, 245, 245)},
    "black": {"hex": "#111111", "vi": "đen", "en": "black", "rgb": (20, 20, 20)},
    "silver": {"hex": "#C0C4CC", "vi": "bạc", "en": "silver", "rgb": (192, 196, 204)},
    "gray": {"hex": "#6B7280", "vi": "xám", "en": "grey", "rgb": (107, 114, 128)},
    "brown": {"hex": "#8B5A3C", "vi": "nâu", "en": "brown", "rgb": (139, 90, 60)},
    "beige": {"hex": "#E9DFC7", "vi": "be", "en": "beige", "rgb": (233, 223, 199)},
    "pink": {"hex": "#F2A7C3", "vi": "hồng", "en": "pink", "rgb": (242, 167, 195)},
    "red": {"hex": "#D94141", "vi": "đỏ", "en": "red", "rgb": (217, 65, 65)},
    "orange": {"hex": "#E8762B", "vi": "cam", "en": "orange", "rgb": (232, 118, 43)},
    "yellow": {"hex": "#F2C230", "vi": "vàng", "en": "yellow", "rgb": (242, 194, 48)},
    "green": {"hex": "#2E8B57", "vi": "xanh lá", "en": "green", "rgb": (46, 139, 87)},
    "cyan": {"hex": "#39B5C8", "vi": "xanh ngọc", "en": "cyan", "rgb": (57, 181, 200)},
    "blue": {"hex": "#2F5BEA", "vi": "xanh dương", "en": "blue", "rgb": (47, 91, 234)},
    "purple": {"hex": "#7B4FD1", "vi": "tím", "en": "purple", "rgb": (123, 79, 209)},
}

TAG_COLORS = ["red", "orange", "yellow", "green", "blue", "purple", "gray", "black"]

# UR-EVD-05: key -> frames analysed per second ("all" = native fps).
FPS_OPTIONS = {"all": None, "10": 10.0, "5": 5.0, "2": 2.0, "1": 1.0, "0.5": 0.5, "0.2": 0.2}

DEFAULT_MODES = {"person": {"gait": True, "attr": True, "face": True, "mask": True}, "vehicle": {"color": True, "plate": True}}

VIDEO_EXTS = {".mp4", ".mov", ".avi", ".mkv"}

CASE_CODE_RE = re.compile(r"^[A-ZĐ]{1,4}-\d{2,5}$")
CAMERA_RE = re.compile(r"CAM_[A-Z]{2,3}_\d{2,4}")
WATCH_PLATE_RE = re.compile(r"^[0-9A-Z]{2,4}-?[0-9A-Z.*?]{2,8}$")

GROUP_LABEL = {"person": ("Con người", "People"), "vehicle": ("Phương tiện", "Vehicles")}
SOURCE_LABEL = {
    "NVR": ("Đầu ghi camera (NVR/DVR)", "Camera recorder (NVR/DVR)"),
    "TRAFFIC": ("Camera giao thông", "Traffic camera"),
    "PHONE": ("Điện thoại, nhân chứng cung cấp", "Phone, from a witness"),
    "OTHER": ("Nguồn khác", "Other source"),
}


def fps_value(key: str, native: float) -> float:
    v = FPS_OPTIONS.get(key, 5.0)
    return native if v is None else min(v, native or v)


def mode_count(modes: dict) -> int:
    return sum(1 for g in modes.values() for on in g.values() if on)


def normalize_modes(modes: dict | None) -> dict:
    out = {g: dict(v) for g, v in DEFAULT_MODES.items()}
    for g, subs in (modes or {}).items():
        if g in out:
            for k, on in subs.items():
                if k in out[g]:
                    out[g][k] = bool(on)
    return out


def analysis_label(fps: str, modes: dict, lang: str = "vi") -> str:
    groups = [GROUP_LABEL[g][0 if lang == "vi" else 1] for g in ("person", "vehicle") if any((modes or {}).get(g, {}).values())]
    head = ("Toàn bộ khung hình" if lang == "vi" else "Every frame") if fps == "all" else f"{fps} FPS"
    return f"{head} · {', '.join(groups)}"


def plate_norm(p: str) -> str:
    """UR-SRCH-04: upper case, drop '-', '.', spaces. Wildcards survive."""
    return re.sub(r"[^0-9A-Z*?]", "", (p or "").upper())


def plate_match(plate: str | None, query: str) -> bool:
    if not plate:
        return False
    n, q = plate_norm(plate), plate_norm(query)
    if not q:
        return False
    if "*" in q or "?" in q:
        rx = "^" + re.escape(q).replace(r"\*", ".*").replace(r"\?", ".") + "$"
        return re.match(rx, n) is not None
    return q in n


def color_name(key: str, lang: str = "vi") -> str:
    c = COLORS.get(key)
    return c[lang] if c else key


def nearest_color(rgb) -> str:
    r, g, b = (float(x) for x in rgb)
    return min(COLORS, key=lambda k: (COLORS[k]["rgb"][0] - r) ** 2 * 0.3 + (COLORS[k]["rgb"][1] - g) ** 2 * 0.59 + (COLORS[k]["rgb"][2] - b) ** 2 * 0.11)
