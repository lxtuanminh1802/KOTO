"""ffmpeg / ffprobe helpers and evidence storage layout."""

import json
import os
import stat
import subprocess
from datetime import datetime
from pathlib import Path

from ..config import get_settings


def probe(path: Path) -> dict:
    s = get_settings()
    try:
        out = subprocess.run(
            [s.ffprobe, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
            capture_output=True, text=True, timeout=60, check=True,
        ).stdout
        data = json.loads(out)
    except (subprocess.SubprocessError, json.JSONDecodeError, FileNotFoundError):
        return {}
    vs = next((st for st in data.get("streams", []) if st.get("codec_type") == "video"), None)
    if not vs:
        return {}
    fmt = data.get("format", {})
    duration = float(fmt.get("duration") or vs.get("duration") or 0)
    num, _, den = (vs.get("avg_frame_rate") or vs.get("r_frame_rate") or "25/1").partition("/")
    try:
        fps = float(num) / float(den or 1)
    except (ValueError, ZeroDivisionError):
        fps = 25.0
    created = (fmt.get("tags") or {}).get("creation_time") or (vs.get("tags") or {}).get("creation_time")
    created_dt = None
    if created:
        try:
            created_dt = datetime.fromisoformat(created.replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError:
            created_dt = None
    return {"duration": duration, "fps": fps if 0 < fps < 241 else 25.0, "width": int(vs.get("width") or 0), "height": int(vs.get("height") or 0),
            "codec": vs.get("codec_name"), "created": created_dt}


def _run(args: list[str], timeout: int = 600) -> bool:
    try:
        subprocess.run(args, capture_output=True, timeout=timeout, check=True)
        return True
    except (subprocess.SubprocessError, FileNotFoundError):
        return False


def frame_at(src: Path, t: float, dst: Path, width: int | None = None) -> bool:
    s = get_settings()
    dst.parent.mkdir(parents=True, exist_ok=True)
    vf = ["-vf", f"scale={width}:-2"] if width else []
    return _run([s.ffmpeg, "-y", "-v", "error", "-ss", f"{max(0.0, t):.3f}", "-i", str(src), "-frames:v", "1", *vf, "-q:v", "3", str(dst)], timeout=60)


def cut(src: Path, start: float, end: float, dst: Path, mode: str | None = None) -> bool:
    s = get_settings()
    dst.parent.mkdir(parents=True, exist_ok=True)
    mode = mode or s.clip_mode
    if mode == "copy":
        args = [s.ffmpeg, "-y", "-v", "error", "-ss", f"{start:.3f}", "-to", f"{end:.3f}", "-i", str(src), "-c", "copy", "-avoid_negative_ts", "make_zero", str(dst)]
    else:
        args = [s.ffmpeg, "-y", "-v", "error", "-ss", f"{start:.3f}", "-i", str(src), "-t", f"{end - start:.3f}", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", str(dst)]
    return _run(args)


def enhance(src: Path, dst: Path, opts: dict, start: float | None = None, end: float | None = None) -> bool:
    """UR-ENH-01 derivative video. Filters: hqdn3d (denoise), eq (shadows), deshake, lanczos 2x, unsharp (deblur)."""
    s = get_settings()
    chain = []
    if opts.get("denoise"):
        chain.append("hqdn3d=4:3:6:4")
    if opts.get("lowlight"):
        chain.append("eq=brightness=0.06:contrast=1.12:gamma=1.35")
    if opts.get("stab"):
        chain.append("deshake")
    if opts.get("super"):
        chain.append("scale=iw*2:ih*2:flags=lanczos")
    if opts.get("deblur"):
        chain.append("unsharp=5:5:1.2:5:5:0.0")
    chain.append("drawtext=text='Da cai thien boi AI':x=w-tw-16:y=16:fontsize=h/30:fontcolor=white:box=1:boxcolor=0x1D4ED8AA:boxborderw=6")
    pre = ["-ss", f"{start:.3f}"] if start is not None else []
    dur = ["-t", f"{end - start:.3f}"] if (start is not None and end is not None) else []
    dst.parent.mkdir(parents=True, exist_ok=True)
    ok = _run([s.ffmpeg, "-y", "-v", "error", *pre, "-i", str(src), *dur, "-vf", ",".join(chain), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-an", str(dst)], timeout=3600)
    if not ok:  # drawtext needs fontconfig; retry without the burned-in label
        ok = _run([s.ffmpeg, "-y", "-v", "error", *pre, "-i", str(src), *dur, "-vf", ",".join(chain[:-1]) or "null", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-an", str(dst)], timeout=3600)
    return ok


def lock_readonly(path: Path) -> None:
    """WORM-style protection for originals: read-only file. Production should add an immutable store (S3 object lock, etc.)."""
    os.chmod(path, stat.S_IRUSR | stat.S_IRGRP | stat.S_IROTH)


def evidence_path(case_code: str, video_id: str, ext: str) -> Path:
    p = get_settings().evidence_dir / case_code / f"{video_id}{ext.lower()}"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def derived_path(*parts: str) -> Path:
    p = get_settings().derived_dir.joinpath(*parts)
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def rel(p: Path) -> str:
    return str(Path(p).resolve().relative_to(get_settings().data_dir.resolve()))


def absolute(relpath: str) -> Path:
    return get_settings().data_dir / relpath
