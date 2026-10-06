"""Render the three sample CCTV clips used by the prototype (Hàng Bài, Hồ Gươm, Ngã Tư Sở) as real H.264 files.

Each clip gets a ground-truth sidecar (tracks, boxes, attributes, plates, identities) keyed by the file's SHA-256.
The simulated engine reads it, so detection boxes sit exactly on the drawn subjects. Pure Pillow + ffmpeg.
"""

import hashlib
import json
import math
import subprocess
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from ..domain import COLORS

W, H, FPS = 1280, 720, 12
K = W / 1600  # prototype scenes are authored at 1600x900
FONT_DIR = Path("/usr/share/fonts/truetype/dejavu")


def font(size: int, mono: bool = False, bold: bool = True):
    name = ("DejaVuSansMono" if mono else "DejaVuSans") + ("-Bold" if bold else "") + ".ttf"
    try:
        return ImageFont.truetype(str(FONT_DIR / name), size)
    except OSError:
        return ImageFont.load_default()


SKIN = ["#E8C2A0", "#D6A67E", "#C48C65", "#EFCDAE"]
HAIR = ["#1B1714", "#2B211B", "#3B2A1F"]


def hx(c: str) -> tuple[int, int, int]:
    c = c.lstrip("#")
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))


@dataclass
class Subject:
    kind: str
    tin: float
    tout: float
    x: float
    y: float
    w: float
    h: float
    vx: float
    seed: int
    attrs: dict = field(default_factory=dict)
    plate: str | None = None
    identity: str | None = None
    track_id: str = ""
    conf: int = 90

    def box(self, t: float) -> dict:
        x = min(max(self.x + (t - self.tin) * self.vx, 0.0), 100 - self.w)
        y = self.y + (math.sin(t * 9 + self.seed) * 0.25 if self.kind == "person" else 0)
        return {"t": round(t, 3), "x": round(x, 2), "y": round(y, 2), "w": self.w, "h": self.h}


# ---------------------------------------------------------------- scenes (ported from the prototype SVG)
def _r(d: ImageDraw.ImageDraw, x, y, w, h, fill, radius=0):
    box = [x * K, y * K, (x + w) * K, (y + h) * K]
    if radius:
        d.rounded_rectangle(box, radius=radius * K, fill=fill)
    else:
        d.rectangle(box, fill=fill)


def _t(d, x, y, txt, size, fill):
    d.text((x * K, (y - size * 0.85) * K), txt, font=font(int(size * K)), fill=fill)


def _windows(d, x, y, cols, rows, w, h, gx, gy, fill):
    for r in range(rows):
        for c in range(cols):
            _r(d, x + c * (w + gx), y + r * (h + gy), w, h, fill, 2)


def _gradient(img: Image.Image, top: str, bottom: str, y0: int, y1: int):
    a, b = hx(top), hx(bottom)
    d = ImageDraw.Draw(img)
    for y in range(int(y0 * K), int(y1 * K)):
        f = (y - y0 * K) / max(1, (y1 - y0) * K)
        d.line([(0, y), (W, y)], fill=tuple(int(a[i] + (b[i] - a[i]) * f) for i in range(3)))


def _motorbike(d, x, y, c):
    for cx in (0, 58):
        d.ellipse([(x + cx - 13) * K, (y + 34 - 13) * K, (x + cx + 13) * K, (y + 34 + 13) * K], fill="#1E2024")
    d.polygon([((x + 4) * K, (y + 30) * K), ((x + 22) * K, (y + 8) * K), ((x + 44) * K, (y + 8) * K), ((x + 54) * K, (y + 30) * K)], fill=c)
    _r(d, x + 18, y + 2, 22, 7, "#2A2C30", 3)


def scene(key: str) -> Image.Image:
    img = Image.new("RGB", (W, H), "#5D6166")
    d = ImageDraw.Draw(img)
    if key == "hangbai":
        _gradient(img, "#AFC0CF", "#D9DEE2", 0, 200)
        _r(d, 0, 70, 260, 140, "#9EA9B3")
        _r(d, 1380, 50, 220, 160, "#A3ADB6")
        for i, (x, w, c) in enumerate([(0, 288, "#CBBFA9"), (288, 512, "#D9D2C3"), (800, 128, "#C7B49A"), (928, 416, "#C9CDD0"), (1344, 256, "#D3C2A4")]):
            _r(d, x, 110 + (i % 2) * 20, w, 400, c)
            _windows(d, x + 24, 150 + (i % 2) * 20, max(1, (w - 24) // 76), 2, 52, 60, 24, 24, "#3B434C")
        _r(d, 288, 318, 512, 64, "#0B6E4F")
        _t(d, 318, 362, "VIETCOMBANK", 36, "#FFFFFF")
        _r(d, 640, 330, 136, 40, "#FFFFFF", 4)
        _t(d, 652, 359, "ATM 24/7", 24, "#0B6E4F")
        _r(d, 300, 390, 230, 120, "#20262C")
        _r(d, 320, 404, 92, 106, "#5C7C8A")
        _r(d, 560, 390, 220, 120, "#2A3036")
        _r(d, 800, 318, 128, 64, "#B53A2E")
        _t(d, 812, 358, "PHỞ BÒ", 26, "#FFE7A8")
        _r(d, 928, 318, 416, 64, "#2F3B4A")
        _t(d, 952, 362, "TRÀNG TIỀN PLAZA", 34, "#E9EDF2")
        _r(d, 1010, 392, 250, 118, "#1C2127")
        _r(d, 1030, 404, 100, 106, "#52616E")
        _r(d, 1140, 404, 100, 106, "#52616E")
        _r(d, 1182, 366, 72, 22, "#1E8F4E", 2)
        _t(d, 1190, 383, "EXIT", 16, "#FFFFFF")
        _r(d, 1344, 318, 256, 64, "#7A4B2A")
        _t(d, 1366, 360, "CÀ PHÊ", 30, "#F6E3C5")
        _r(d, 0, 510, 1600, 110, "#B8B3AB")
        for x in range(0, 1600, 80):
            _r(d, x, 510, 1, 110, "#A5A098")
        _r(d, 0, 618, 1600, 10, "#8C8781")
        _r(d, 0, 628, 1600, 272, "#5D6166")
        for x in range(40, 1600, 220):
            _r(d, x, 770, 120, 8, "#E9E9E4")
        _r(d, 866, 210, 10, 410, "#3E4349")
        _r(d, 840, 206, 70, 10, "#3E4349", 4)
        _motorbike(d, 1400, 560, "#9B2C2C")
        _motorbike(d, 1480, 566, "#2C4C9B")
        _motorbike(d, 40, 560, "#3A3D42")
    elif key == "hoguom":
        _gradient(img, "#C3CFD6", "#E2E4DF", 0, 300)
        _gradient(img, "#7F9C9F", "#5E7C80", 260, 490)
        for i in range(9):
            _r(d, 90 + i * 190, 300 + (i % 3) * 30, 60 + (i % 2) * 40, 2, "#B7CBCB")
        d.ellipse([1110 * K, 340 * K, 1250 * K, 364 * K], fill="#56704A")
        _r(d, 1150, 300, 60, 52, "#B9A98E")
        _r(d, 1160, 284, 40, 20, "#AE9E82")
        _r(d, 1170, 270, 20, 16, "#A49378")
        d.arc([120 * K, 330 * K, 520 * K, 510 * K], 200, 340, fill="#C0262D", width=int(16 * K))
        _r(d, 120, 416, 400, 8, "#9E1F25")
        for x, r in [(0, 160), (260, 210), (560, 170), (860, 200), (1180, 160), (1450, 210)]:
            d.ellipse([(x + 80 - r) * K, (40 - r) * K, (x + 80 + r) * K, (40 + r) * K], fill="#3F5A3A")
            r2 = r * 0.7
            d.ellipse([(x + 160 - r2) * K, (90 - r2) * K, (x + 160 + r2) * K, (90 + r2) * K], fill="#4C6B44")
        for x in (300, 1010):
            _r(d, x, 120, 26, 450, "#4A3B2E")
        _r(d, 0, 486, 1600, 18, "#6E6A64")
        for x in range(0, 1600, 40):
            _r(d, x, 466, 4, 22, "#6E6A64")
        _r(d, 0, 504, 1600, 140, "#C4BCB0")
        for y in range(520, 644, 24):
            _r(d, 0, y, 1600, 1, "#B3AB9F")
        _r(d, 0, 640, 1600, 10, "#8C8781")
        _r(d, 0, 650, 1600, 250, "#5A5E63")
        for x in range(80, 1600, 240):
            _r(d, x, 790, 130, 8, "#E9E9E4")
    else:  # ngatuso
        _gradient(img, "#8E98A8", "#C8BCB0", 0, 320)
        for x, y, w, c in [(40, 40, 180, "#646B76"), (260, 90, 140, "#727985"), (1180, 20, 200, "#5E6570"), (1420, 70, 150, "#6C7380")]:
            _r(d, x, y, w, 300, c)
            _windows(d, x + 16, y + 20, (w - 16) // 34, 6, 20, 16, 14, 18, "#E8C878")
        _r(d, 0, 200, 1600, 70, "#9A9DA1")
        _r(d, 0, 262, 1600, 12, "#7D8085")
        _r(d, 0, 196, 1600, 6, "#B6B8BA")
        for x in (260, 780, 1300):
            _r(d, x, 274, 70, 250, "#8B8E92")
        _r(d, 0, 300, 1600, 600, "#55585E")
        _r(d, 0, 530, 1600, 14, "#F2F2EE")
        for x in range(60, 1600, 110):
            _r(d, x, 560, 60, 190, "#E7E7E2")
        for x in range(0, 1600, 400):
            _r(d, x + 180, 420, 8, 90, "#E7E7E2")
        _r(d, 1500, 180, 12, 360, "#2E3136")
        _r(d, 1474, 180, 64, 150, "#202326", 8)
        for cy, c in [(214, "#FF4A3D"), (256, "#3B2F12"), (298, "#123B22")]:
            d.ellipse([(1506 - 18) * K, (cy - 18) * K, (1506 + 18) * K, (cy + 18) * K], fill=c)
    return img


# ---------------------------------------------------------------- subjects (ported from personInner / carInner)
def draw_person(img: Image.Image, s: Subject, b: dict, t: float):
    d = ImageDraw.Draw(img)
    X, Y, BW, BH = b["x"] / 100 * W, b["y"] / 100 * H, b["w"] / 100 * W, b["h"] / 100 * H
    sx, sy = BW / 40, BH / 100

    def R(x, y, w, h, fill, rad=0):
        box = [X + x * sx, Y + y * sy, X + (x + w) * sx, Y + (y + h) * sy]
        (d.rounded_rectangle(box, radius=rad * sx, fill=fill) if rad else d.rectangle(box, fill=fill))

    def C(cx, cy, r, fill):
        d.ellipse([X + (cx - r) * sx, Y + (cy - r) * sx, X + (cx + r) * sx, Y + (cy + r) * sx], fill=fill)

    a = s.attrs
    sk, hr = SKIN[s.seed % 4], HAIR[s.seed % 3]
    top, bot = COLORS[a["top_color"]]["hex"], COLORS[a["bottom_color"]]["hex"]
    f, long_, bag, hat = a["gender"] == "f", a["top"] == "long", "bag" in a["accessories"], "hat" in a["accessories"]
    swing = math.sin(t * 6 + s.seed) * 1.6 if abs(s.vx) > 0.01 else 0
    d.ellipse([X + 9 * sx, Y + 95.5 * sy, X + 31 * sx, Y + 99.5 * sy], fill=(40, 40, 40))
    if bag:
        R(25, 20, 10, 23, "#2B2F36", 3)
    if f:
        R(13, 4, 14, 19, hr, 6)
    legc = sk if a["bottom"] in ("skirt", "shorts") else bot
    R(12.5 + swing, 50, 7, 44, legc, 2)
    R(20.5 - swing, 50, 7, 44, legc, 2)
    if a["bottom"] == "skirt":
        d.polygon([(X + 12 * sx, Y + 50 * sy), (X + 28 * sx, Y + 50 * sy), (X + 31.5 * sx, Y + 74 * sy), (X + 8.5 * sx, Y + 74 * sy)], fill=bot)
    elif a["bottom"] == "shorts":
        R(12, 49, 16, 19, bot, 2)
    R(12 + swing, 93, 8, 4, "#1E2024", 1.5)
    R(20.5 - swing, 93, 8, 4, "#1E2024", 1.5)
    R(6.5, 19.5, 5, 30 if long_ else 10, top, 2.5)
    R(28.5, 19.5, 5, 30 if long_ else 10, top, 2.5)
    if not long_:
        R(7, 28, 4, 21, sk, 2)
        R(29, 28, 4, 21, sk, 2)
    C(9, 51, 2.4, sk)
    C(31, 51, 2.4, sk)
    R(11, 18, 18, 34, top, 4)
    if bag:
        R(13, 18, 2.2, 20, "#2B2F36", 1)
        R(24.8, 18, 2.2, 20, "#2B2F36", 1)
    R(17.5, 14, 5, 5, sk)
    C(20, 10, 6, sk)
    # hair cap, eyes
    d.chord([X + 14 * sx, Y + 10 * sy - 6 * sx, X + 26 * sx, Y + 10 * sy + 6 * sx], 180, 360, fill=hr)
    C(17.6, 10.6, 0.8, "#231F1C")
    C(22.4, 10.6, 0.8, "#231F1C")
    if hat:
        cap = "#1F2A44" if s.seed % 2 else "#B8B0A0"
        d.chord([X + 13.6 * sx, Y + 8 * sy - 6.4 * sx, X + 26.4 * sx, Y + 8 * sy + 6.4 * sx], 180, 360, fill=cap)
        R(9.5, 7, 9, 2, cap, 1)
    if a.get("mask"):
        R(15.4, 10.4, 9.2, 5.4, "#E4EAEE", 2.2)


def draw_car(img: Image.Image, s: Subject, b: dict):
    d = ImageDraw.Draw(img)
    X, Y, BW, BH = b["x"] / 100 * W, b["y"] / 100 * H, b["w"] / 100 * W, b["h"] / 100 * H
    sx, sy = BW / 160, BH / 90
    c = COLORS[s.attrs["color"]]["hex"]
    suv = s.attrs["vehicle_type"] == "suv"

    def R(x, y, w, h, fill, rad=0):
        box = [X + x * sx, Y + y * sy, X + (x + w) * sx, Y + (y + h) * sy]
        (d.rounded_rectangle(box, radius=rad * sx, fill=fill) if rad else d.rectangle(box, fill=fill))

    def P(pts, fill):
        d.polygon([(X + px * sx, Y + py * sy) for px, py in pts], fill=fill)

    d.ellipse([X + 6 * sx, Y + 79 * sy, X + 154 * sx, Y + 89 * sy], fill=(35, 35, 35))
    R(18, 72, 22, 14, "#18191C", 3)
    R(120, 72, 22, 14, "#18191C", 3)
    if suv:
        P([(30, 6), (130, 6), (140, 32), (20, 32)], c)
        P([(36, 11), (124, 11), (131, 29), (29, 29)], "#1E2A36")
    else:
        P([(38, 16), (122, 16), (136, 42), (24, 42)], c)
        P([(44, 20), (116, 20), (126, 38), (34, 38)], "#1E2A36")
    R(12, 40, 136, 36, c, 9)
    R(16, 46, 30, 9, "#C3262A", 3)
    R(114, 46, 30, 9, "#C3262A", 3)
    R(10, 68, 140, 10, "#2A2C30", 4)
    R(56, 61, 48, 16, "#F4F4F0", 2)
    d.rectangle([X + 56 * sx, Y + 61 * sy, X + 104 * sx, Y + 77 * sy], outline="#15171C", width=max(1, int(1.2 * sx)))
    size = max(8, int(12 * sy))
    fnt = font(size, mono=True)
    while size > 7 and d.textlength(s.plate, font=fnt) > 44 * sx:
        size -= 1
        fnt = font(size, mono=True)
    tw = d.textlength(s.plate, font=fnt)
    d.text((X + 80 * sx - tw / 2, Y + 63.5 * sy), s.plate, font=fnt, fill="#15171C")


# ---------------------------------------------------------------- casting
def P(gender, top, bottom, mask, acc, ctop, cbot, tin, tout, x, y, vx, seed, identity=None):
    return Subject("person", tin, tout, x, y + 12, 5.5, 29, vx, seed,
                   {"gender": gender, "top": top, "top_color": ctop, "bottom": bottom, "bottom_color": cbot, "mask": bool(mask), "accessories": acc,
                    "gait": "fast" if abs(vx) > 0.4 else "normal"}, identity=identity)


def V(vtype, color, plate, tin, tout, x, y, vx, seed):
    return Subject("vehicle", tin, tout, x, y, 22, 22, vx, seed, {"vehicle_type": vtype, "color": color}, plate=plate, identity="plate:" + plate)


CLIPS = {
    "CAM_HK_014_HangBai.mp4": {
        "scene": "hangbai", "camera": "CAM_HK_014", "duration": 116, "start": "2026-10-01T14:14:15",
        "subjects": [
            P("m", "long", "pants", 0, ["bag"], "black", "blue", 0, 14, 22, 30, 0.35, 0, "suspect"),
            P("m", "short", "pants", 0, [], "blue", "gray", 4, 29, 48, 28, -0.25, 1),
            P("f", "short", "skirt", 1, ["bag"], "pink", "red", 10, 30, 60, 26, 0.3, 2, "pinkskirt"),
            P("m", "long", "pants", 1, ["hat"], "green", "black", 18, 42, 35, 32, -0.2, 3),
            P("f", "long", "pants", 0, ["bag"], "white", "beige", 22, 48, 70, 24, 0.25, 4),
            P("m", "short", "shorts", 0, ["hat", "bag"], "gray", "beige", 30, 55, 15, 34, -0.15, 5),
            P("f", "short", "pants", 0, [], "yellow", "blue", 41, 70, 55, 30, 0.3, 6),
            P("m", "long", "pants", 0, ["bag"], "black", "black", 52, 80, 40, 28, -0.3, 7, "blackbag"),
            P("f", "long", "skirt", 0, ["bag"], "red", "black", 60, 92, 25, 30, 0.2, 8),
            P("m", "short", "pants", 1, [], "white", "blue", 75, 104, 65, 32, -0.25, 9),
            V("car", "yellow", "30G-567.89", 88, 110, 74, 52, -0.4, 0),
        ],
    },
    "CAM_HK_009_HoGuom.mp4": {
        "scene": "hoguom", "camera": "CAM_HK_009", "duration": 94, "start": "2026-10-01T14:15:02",
        "subjects": [
            P("m", "long", "pants", 0, ["bag"], "black", "blue", 5, 36, 30, 30, 0.4, 0, "suspect"),
            P("f", "short", "shorts", 0, ["hat"], "orange", "white", 12, 50, 58, 28, -0.3, 11),
            V("car", "silver", "29A-123.45", 20, 44, 70, 50, -0.5, 1),
            P("m", "short", "pants", 0, [], "purple", "gray", 40, 80, 44, 32, 0.25, 12),
            P("f", "long", "pants", 1, ["bag"], "cyan", "black", 55, 90, 20, 30, 0.3, 13),
            P("f", "short", "skirt", 1, ["bag"], "pink", "red", 60, 80, 70, 27, -0.35, 2, "pinkskirt"),
            P("m", "long", "pants", 0, ["bag"], "black", "black", 66, 92, 12, 31, 0.3, 7, "blackbag"),
        ],
    },
    "CAM_DD_022_NgaTuSo.mp4": {
        "scene": "ngatuso", "camera": "CAM_DD_022", "duration": 52, "start": "2026-10-01T14:56:08",
        "subjects": [
            V("car", "yellow", "30G-567.89", 2, 20, 10, 45, 0.6, 0),
            V("car", "silver", "29A-123.45", 8, 30, 50, 48, -0.4, 1),
            V("car", "gray", "30E-882.16", 15, 40, 30, 50, 0.5, 2),
            V("suv", "green", "29H-045.71", 25, 50, 62, 44, -0.3, 3),
            P("m", "short", "pants", 0, ["hat"], "white", "black", 6, 26, 20, 50, 0.9, 14),
            P("f", "long", "pants", 0, ["bag"], "red", "blue", 30, 50, 80, 50, -0.8, 15),
        ],
    },
}


def _finalize_cast(spec: dict) -> list[Subject]:
    subs = sorted(spec["subjects"], key=lambda s: s.tin)
    np_, nv = 0, 0
    for s in subs:
        if s.kind == "person":
            np_ += 1
            s.track_id = f"P{np_:02d}"
            s.conf = 86 + (np_ * 7) % 13
        else:
            nv += 1
            s.track_id = f"X{nv:02d}"
            s.conf = 90 + (nv * 3) % 9
    return subs


def render(name: str, out_dir: Path) -> tuple[Path, Path, str]:
    """Returns (video, truth, sha256). Skips work if the file already exists."""
    spec = CLIPS[name]
    out_dir.mkdir(parents=True, exist_ok=True)
    dst = out_dir / name
    subs = _finalize_cast(spec)
    start = datetime.fromisoformat(spec["start"])
    if not dst.exists():
        bg = scene(spec["scene"])
        osd = font(18, mono=True)
        n = int(spec["duration"] * FPS)
        start_utc = (start - timedelta(hours=7)).isoformat() + "Z"
        proc = subprocess.Popen(
            ["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
             "-vf", "noise=alls=7:allf=t,gblur=sigma=0.6,eq=saturation=0.75", "-c:v", "libx264", "-preset", "veryfast", "-crf", "24",
             "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-metadata", f"creation_time={start_utc}", str(dst)],
            stdin=subprocess.PIPE,
        )
        for i in range(n):
            t = i / FPS
            frame = bg.copy()
            live = [(s, s.box(t)) for s in subs if s.tin <= t <= s.tout]
            for s, b in sorted(live, key=lambda p: p[1]["y"] + p[1]["h"]):
                (draw_person if s.kind == "person" else lambda im, ss, bb, tt: draw_car(im, ss, bb))(frame, s, b, t)
            d = ImageDraw.Draw(frame)
            stamp = (start + timedelta(seconds=t)).strftime("%d-%m-%Y %H:%M:%S")
            label = f"{spec['camera']}  {stamp}"
            tw = d.textlength(label, font=osd)
            d.rectangle([W - tw - 24, H - 40, W - 8, H - 12], fill=(0, 0, 0))
            d.text((W - tw - 16, H - 37), label, font=osd, fill=(235, 235, 235))
            proc.stdin.write(frame.tobytes())
        proc.stdin.close()
        if proc.wait() != 0:
            raise RuntimeError(f"ffmpeg failed for {name}")
    sha = hashlib.sha256(dst.read_bytes()).hexdigest()
    tracks = []
    for s in subs:
        boxes, t = [], s.tin
        while t <= s.tout + 1e-6:
            boxes.append(s.box(t))
            t += 1 / FPS
        mid = s.box((s.tin + s.tout) / 2)
        tr = {"track_id": s.track_id, "kind": s.kind, "t_in": s.tin, "t_out": s.tout, "boxes": boxes, "confidence": s.conf,
              "attributes": dict(s.attrs), "identity": s.identity or f"{name}:{s.track_id}", "best_t": mid["t"]}
        if s.kind == "person" and not s.attrs.get("mask"):
            tr["face_box"] = {"t": mid["t"], "x": mid["x"] + mid["w"] * 8 / 40, "y": mid["y"], "w": mid["w"] * 24 / 40, "h": mid["h"] * 24 / 100}  # head and shoulders
        if s.plate:
            tr["plate"] = s.plate
            tr["plate_confidence"] = 58 + (s.conf * 7) % 35
        tracks.append(tr)
    truth = out_dir / f"{sha}.json"
    truth.write_text(json.dumps({"file": name, "camera": spec["camera"], "start_local": spec["start"], "tracks": tracks}, ensure_ascii=False), encoding="utf-8")
    return dst, truth, sha


if __name__ == "__main__":
    import sys

    out = Path(sys.argv[1] if len(sys.argv) > 1 else "data/demo")
    for n in CLIPS:
        print(render(n, out))
