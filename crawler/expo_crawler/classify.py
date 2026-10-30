"""Gợi ý mảng sản phẩm theo từ khóa. Chỉ là gợi ý, người dùng sửa lại trên web trước khi chuyển sang phát triển."""

from __future__ import annotations

import re

# Thứ tự quan trọng khi bằng điểm: mảng đứng trước thắng
DEFAULT_RULES: list[tuple[str, list[str]]] = [
    ("A05", ["cyber", "security operations", "soc", "siem", "threat intelligence", "threat detection", "malware", "ransomware",
             "penetration test", "pentest", "vulnerability", "encryption", "cryptograph", "zero trust", "firewall",
             "endpoint", "digital forensic", "mobile forensic", "osint", "data protection", "identity", "authentication",
             "ddos", "incident response", "network security", "intrusion"]),
    ("C09", ["radio", "tactical communication", "secure communication", "satcom", "satellite", "sdr", "software defined radio",
             "spectrum", "manet", "mesh network", "tetra", "antenna", "rf", "signal intelligence", "sigint"]),
    ("UAV", ["drone", "uav", "uas", "unmanned aerial", "counter-drone", "counter drone", "c-uas", "anti-drone", "vtol"]),
    ("Thiết bị an ninh", ["cctv", "camera", "video surveillance", "anpr", "lpr", "thermal", "access control", "perimeter",
                          "x-ray", "screening", "metal detector", "body-worn", "intercom", "alarm", "biometric", "face recognition"]),
    ("A06", ["forensic science", "crime scene", "trace detection", "explosive detection", "narcotics", "night vision",
             "optics", "ballistic", "riot", "law enforcement equipment"]),
]


def suggest_mang(text: str, rules: list[tuple[str, list[str]]] | None = None, default: str | None = None) -> tuple[str, list[str]]:
    """Trả về (mảng gợi ý, các từ khóa khớp). Không khớp gì thì trả default hoặc "Khác"."""
    t = re.sub(r"\s+", " ", (text or "").lower())
    best, best_hits = None, []
    for mang, kws in rules or DEFAULT_RULES:
        # Từ khóa ngắn (soc, sdr, uav...) phải khớp nguyên từ; từ khóa dài chỉ cần khớp đầu từ (cyber → cybersecurity)
        hits = [k.strip() for k in kws
                if re.search(r"(?<![a-z])" + re.escape(k.strip()) + (r"(?![a-z])" if len(k.strip()) <= 4 else ""), t)]
        if len(hits) > len(best_hits):
            best, best_hits = mang, hits
    if best is None:
        return default or "Khác", []
    return best, best_hits
