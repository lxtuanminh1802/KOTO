"""Natural-language description → structured filters (UR-SRCH-02). Vietnamese with or without accents, and English."""

import re
import unicodedata

from ..domain import color_name

FILTER_KEYS = ("gender", "top", "bottom", "mask", "acc", "color")

OPT_LABEL = {
    ("gender", "m"): ("Nam", "Male"), ("gender", "f"): ("Nữ", "Female"),
    ("top", "long"): ("Dài tay", "Long sleeve"), ("top", "short"): ("Ngắn tay", "Short sleeve"),
    ("bottom", "pants"): ("Quần dài", "Trousers"), ("bottom", "shorts"): ("Quần short", "Shorts"), ("bottom", "skirt"): ("Váy", "Skirt"),
    ("mask", "yes"): ("Khẩu trang: có đeo", "Face mask: wearing"), ("mask", "no"): ("Khẩu trang: không đeo", "Face mask: not wearing"),
    ("acc", "bag"): ("Túi / ba lô", "Bag"), ("acc", "hat"): ("Mũ", "Hat"),
}

COLOR_WORDS = {
    "black": "den|black", "white": "trang|white", "gray": "xam|ghi|gray|grey", "red": "do|red", "blue": "xanh duong|xanh nuoc bien|blue|navy",
    "green": "xanh la|green", "yellow": "vang|yellow", "pink": "hong|pink", "purple": "tim|purple", "orange": "cam|orange", "beige": "be|beige",
    "brown": "nau|brown", "silver": "bac|silver", "cyan": "xanh ngoc|cyan",
}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFD", s.lower())
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    return s.replace("đ", "d")


def empty_filters() -> dict:
    return {k: [] for k in FILTER_KEYS} | {"from": "", "to": ""}


def parse(q: str) -> dict:
    s = " " + re.sub(r"[.,;!?]", " ", norm(q)) + " "
    s = re.sub(r"^\s*(hay |giup toi |cho toi )?(tim kiem|tim|loc|find|search|show me|show)\b", " ", s)
    f = empty_filters()
    has = lambda rx: re.search(rx, s) is not None  # noqa: E731
    if has(r"\b(nam|dan ong|thanh nien nam|male|man|men)\b"):
        f["gender"].append("m")
    if has(r"\b(nu|phu nu|co gai|female|woman|women|girl)\b"):
        f["gender"].append("f")
    if has(r"\b(dai tay|long sleeve|ao khoac|hoodie|jacket)\b"):
        f["top"].append("long")
    if has(r"\b(ngan tay|coc tay|ao phong|t-shirt|tshirt|short sleeve)\b"):
        f["top"].append("short")
    if has(r"\b(quan (short|dui|ngan|sooc)|shorts)\b"):
        f["bottom"].append("shorts")
    if has(r"\b(quan dai|quan jean|quan bo|trousers|pants|jeans)\b"):
        f["bottom"].append("pants")
    if has(r"\b(vay|dam|skirt|dress)\b"):
        f["bottom"].append("skirt")
    if has(r"\b(khong deo khau trang|no mask|without mask|unmasked)\b"):
        f["mask"].append("no")
    elif has(r"\b(khau trang|mask|masked)\b"):
        f["mask"].append("yes")
    if has(r"\b(ba lo|tui|balo|bag|backpack|handbag)\b"):
        f["acc"].append("bag")
    if has(r"\b(mu|non|hat|cap)\b"):
        f["acc"].append("hat")
    vehicle = has(r"\b(xe|o to|oto|car|vehicle|suv|sedan)\b")
    for k, words in COLOR_WORDS.items():
        if re.search(rf"\b({words})\b", s):
            f["color"].append(k)
    empty = not vehicle and not any(f[k] for k in FILTER_KEYS)
    return {"filters": f, "vehicle": vehicle, "empty": empty, "understood_vi": describe(f, "vi", vehicle), "understood_en": describe(f, "en", vehicle)}


def describe(f: dict, lang: str, vehicle: bool = False) -> list[str]:
    out = [("Phương tiện" if lang == "vi" else "Vehicles")] if vehicle else []
    for k in FILTER_KEYS[:-1]:
        for v in f.get(k, []):
            lab = OPT_LABEL.get((k, v))
            if lab:
                out.append(lab[0 if lang == "vi" else 1])
    out += [color_name(c, lang) for c in f.get("color", [])]
    return out
