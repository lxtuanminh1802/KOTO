from datetime import datetime

from .domain import analysis_label
from .models import Camera, Case, Detection, Tag, User, Video, WatchItem
from .permissions import permissions_for

DEFAULT_USER_SETTINGS = {"min_conf": 70, "watermark": True, "auto_redact": False, "notify": True, "theme": "light", "lang": "vi", "idle_lock_minutes": 10}


def iso(d: datetime | None) -> str | None:
    return d.isoformat() + "Z" if d else None


def user_settings(u: User) -> dict:
    return {**DEFAULT_USER_SETTINGS, **(u.settings or {})}


def user_out(u: User, full: bool = False) -> dict:
    out = {"id": u.id, "username": u.username, "full_name": u.full_name, "title": u.title, "unit": u.unit, "role": u.role.value}
    if full:
        out |= {"settings": user_settings(u), "permissions": permissions_for(u), "welcome_seen": u.welcome_seen, "totp_confirmed": u.totp_confirmed, "has_pin": bool(u.pin_hash)}
    return out


def case_out(c: Case) -> dict:
    return {
        "id": c.id, "code": c.code, "title": c.title, "decision_no": c.decision_no, "status": c.status.value,
        "opened_at": iso(c.opened_at), "lead_user_id": c.lead_user_id, "lead_name": c.lead.full_name if c.lead else "",
        "report_exported": c.report_exported,
    }


def camera_out(c: Camera | None) -> dict | None:
    if not c:
        return None
    return {"id": c.id, "name": c.name, "lat": c.lat, "lng": c.lng, "clock_offset_sec": c.clock_offset_sec}


def video_out(v: Video, cam: Camera | None = None, objects: int | None = None) -> dict:
    return {
        "id": v.id, "evidence_id": v.evidence_id, "case_id": v.case_id, "parent_id": v.parent_id,
        "name": v.display_name, "original_file_name": v.original_file_name, "size_bytes": v.size_bytes,
        "sha256": v.sha256, "integrity": v.integrity.value, "verified_at": iso(v.verified_at),
        "state": v.state.value, "progress": round(v.progress, 1), "camera_id": v.camera_id, "camera": camera_out(cam),
        "recorded_start": iso(v.recorded_start), "duration": v.duration_sec, "width": v.width, "height": v.height,
        "clip_start": v.clip_start, "clip_end": v.clip_end, "cut_seq": v.cut_seq, "source": v.source.value,
        "acquired_at": iso(v.acquired_at), "acquired_by": v.acquirer.full_name if v.acquirer else "",
        "analysis": {"fps": v.analysis_fps, "modes": v.analysis_modes, "version": v.analysis_version, "engine": v.analysis_engine,
                     "label_vi": analysis_label(v.analysis_fps, v.analysis_modes, "vi"), "label_en": analysis_label(v.analysis_fps, v.analysis_modes, "en")},
        "alerts": v.alerts_count, "objects": objects, "has_file": bool(v.storage_path), "error": v.error,
        "thumb_url": f"/api/media/videos/{v.id}/thumb" if v.thumb_path else None,
    }


def detection_out(d: Detection, watch_ids: set[str] | None = None) -> dict:
    a = d.attributes or {}
    return {
        "id": d.id, "video_id": d.video_id, "track_id": d.track_id, "kind": d.kind.value.lower(),
        "t_in": d.t_in, "t_out": d.t_out, "boxes": d.boxes, "attributes": a,
        "plate": d.plate_text, "plate_confidence": d.plate_confidence, "plate_alternatives": d.plate_alternatives or [],
        "confidence": round(d.confidence), "path": d.path or [], "watch_item_id": d.watch_item_id if (watch_ids is None or d.watch_item_id in watch_ids) else None,
        "alerted": d.alerted, "has_face": bool(d.face_embedding),
        "crop_url": f"/api/media/detections/{d.id}/crop" if d.crop_path else None,
        "face_url": f"/api/media/detections/{d.id}/face" if d.face_path else None,
    }


def tag_out(t: Tag) -> dict:
    return {"id": t.id, "case_id": t.case_id, "video_id": t.video_id, "detection_id": t.detection_id, "t": t.t, "color": t.color, "note": t.note, "created_at": iso(t.created_at)}


def watch_out(w: WatchItem) -> dict:
    return {
        "id": w.id, "kind": w.kind.value.lower(), "plate": w.plate_pattern, "name": w.name, "note": w.note,
        "by": w.creator.full_name if w.creator else "", "created_at": iso(w.created_at), "ref_detection_id": w.ref_detection_id,
        "images": [f"/api/media/watch/{im.id}" for im in w.images],
    }
