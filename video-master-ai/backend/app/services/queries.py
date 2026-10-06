"""Read helpers shared by several routers."""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import Camera, Case, Detection, Video, VideoState
from ..serializers import video_out

LIVE = (VideoState.REMOVED, VideoState.REJECTED)


def live_videos(db: Session, case_id: str | None = None) -> list[Video]:
    q = select(Video).where(Video.deleted_at.is_(None), Video.state.not_in(LIVE))
    if case_id:
        q = q.where(Video.case_id == case_id)
    return list(db.execute(q.order_by(Video.created_at)).scalars())


def current_detections(db: Session, video_ids: list[str], min_conf: float | None = None, kind=None) -> list[Detection]:
    """Detections of the latest analysis version of each video."""
    if not video_ids:
        return []
    vids = {v.id: v for v in db.execute(select(Video).where(Video.id.in_(video_ids))).scalars()}
    out = []
    q = select(Detection).where(Detection.video_id.in_(list(vids)))
    if min_conf is not None:
        q = q.where(Detection.confidence >= min_conf)
    if kind is not None:
        q = q.where(Detection.kind == kind)
    for d in db.execute(q).scalars():
        if d.analysis_version == vids[d.video_id].analysis_version:
            out.append(d)
    return out


def object_counts(db: Session, videos: list[Video], min_conf: float) -> dict[str, int]:
    if not videos:
        return {}
    rows = db.execute(
        select(Detection.video_id, Detection.analysis_version, func.count())
        .where(Detection.video_id.in_([v.id for v in videos]), Detection.confidence >= min_conf)
        .group_by(Detection.video_id, Detection.analysis_version)
    ).all()
    ver = {v.id: v.analysis_version for v in videos}
    return {vid: n for vid, av, n in rows if ver.get(vid) == av}


def videos_out(db: Session, videos: list[Video], min_conf: float) -> list[dict]:
    cams = {c.id: c for c in db.execute(select(Camera)).scalars()}
    counts = object_counts(db, videos, min_conf)
    return [video_out(v, cams.get(v.camera_id), counts.get(v.id, 0) if v.state == VideoState.ANALYZED else None) for v in videos]


def root_of(db: Session, v: Video) -> Video:
    return db.get(Video, v.parent_id) if v.parent_id else v


def case_of_video(db: Session, v: Video) -> Case:
    return db.get(Case, v.case_id)
