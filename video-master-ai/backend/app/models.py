"""Data model. Mirrors the URD Data Dictionary (sheet "Data Dictionary", WF-10).

Times are stored as naive UTC datetimes; the UI shows them in GMT+7 (NFR-INT-02).
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def uid() -> str:
    return str(uuid.uuid4())


# BIGINT on MySQL; SQLite only autoincrements a plain INTEGER primary key (unit tests).
BIGPK = BigInteger().with_variant(Integer, "sqlite")

def utcnow() -> datetime:
    return datetime.utcnow().replace(microsecond=0)


class Role(str, enum.Enum):
    INVESTIGATOR = "INVESTIGATOR"  # Điều tra viên (becomes "phụ trách" on cases they lead)
    EXPERT = "EXPERT"  # Giám định viên / Kỹ thuật
    COMMANDER = "COMMANDER"  # Chỉ huy
    VIEWER = "VIEWER"  # Người xem
    ADMIN = "ADMIN"  # Quản trị hệ thống


class CaseStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    SUSPENDED = "SUSPENDED"
    CLOSED = "CLOSED"


class VideoState(str, enum.Enum):  # WF-04
    UPLOADING = "UPLOADING"
    HASHING = "HASHING"
    REJECTED = "REJECTED"
    QUEUED = "QUEUED"
    ANALYZING = "ANALYZING"
    ANALYZED = "ANALYZED"
    FAILED = "FAILED"
    REMOVED = "REMOVED"


class VideoSource(str, enum.Enum):
    NVR = "NVR"
    TRAFFIC = "TRAFFIC"
    PHONE = "PHONE"
    OTHER = "OTHER"


class Integrity(str, enum.Enum):
    UNKNOWN = "UNKNOWN"
    OK = "OK"
    MISMATCH = "MISMATCH"


class JobStatus(str, enum.Enum):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    DONE = "DONE"
    FAILED = "FAILED"


class JobKind(str, enum.Enum):
    ANALYZE = "ANALYZE"
    ENHANCE = "ENHANCE"


class DetKind(str, enum.Enum):
    PERSON = "PERSON"
    VEHICLE = "VEHICLE"


class WatchKind(str, enum.Enum):
    FACE = "FACE"
    PLATE = "PLATE"


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    username: Mapped[str] = mapped_column(String(64), unique=True)
    full_name: Mapped[str] = mapped_column(String(128))
    title: Mapped[str] = mapped_column(String(128), default="")  # chức danh
    unit: Mapped[str] = mapped_column(String(128), default="")  # đơn vị
    role: Mapped[Role] = mapped_column(Enum(Role), default=Role.INVESTIGATOR)
    password_hash: Mapped[str] = mapped_column(String(128))
    totp_secret: Mapped[str | None] = mapped_column(String(64), nullable=True)
    totp_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    pin_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    failed_logins: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    pin_failures: Mapped[int] = mapped_column(Integer, default=0)
    welcome_seen: Mapped[bool] = mapped_column(Boolean, default=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    settings: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class AuthSession(Base):
    __tablename__ = "auth_sessions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    ip: Mapped[str] = mapped_column(String(64), default="")
    user_agent: Mapped[str] = mapped_column(String(255), default="")


class Case(Base):
    __tablename__ = "cases"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    code: Mapped[str] = mapped_column(String(12), unique=True)
    title: Mapped[str] = mapped_column(String(255))
    decision_no: Mapped[str] = mapped_column(String(50), default="")
    lead_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    status: Mapped[CaseStatus] = mapped_column(Enum(CaseStatus), default=CaseStatus.ACTIVE)
    opened_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    ev_seq: Mapped[int] = mapped_column(Integer, default=0)  # NN counter for EV codes, never reused
    report_exported: Mapped[bool] = mapped_column(Boolean, default=False)

    lead: Mapped[User] = relationship(foreign_keys=[lead_user_id], lazy="joined")


class Camera(Base):
    __tablename__ = "cameras"
    id: Mapped[str] = mapped_column(String(30), primary_key=True)  # CAM_HK_014
    name: Mapped[str] = mapped_column(String(255), default="")
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    clock_offset_sec: Mapped[int] = mapped_column(Integer, default=0)


class Video(Base):
    __tablename__ = "videos"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    evidence_id: Mapped[str | None] = mapped_column(String(24), unique=True, nullable=True)
    case_id: Mapped[str] = mapped_column(ForeignKey("cases.id"), index=True)
    parent_id: Mapped[str | None] = mapped_column(ForeignKey("videos.id"), nullable=True, index=True)
    display_name: Mapped[str] = mapped_column(String(255))
    original_file_name: Mapped[str] = mapped_column(String(255))
    storage_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    proxy_path: Mapped[str | None] = mapped_column(String(512), nullable=True)  # browser playback copy; the original is never served transcoded
    size_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    sha256_client: Mapped[str | None] = mapped_column(String(64), nullable=True)
    integrity: Mapped[Integrity] = mapped_column(Enum(Integrity), default=Integrity.UNKNOWN)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    state: Mapped[VideoState] = mapped_column(Enum(VideoState), default=VideoState.UPLOADING)
    progress: Mapped[float] = mapped_column(Float, default=0)
    camera_id: Mapped[str] = mapped_column(String(30), index=True)
    recorded_start: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    duration_sec: Mapped[float] = mapped_column(Float, default=0)
    width: Mapped[int] = mapped_column(Integer, default=0)
    height: Mapped[int] = mapped_column(Integer, default=0)
    native_fps: Mapped[float] = mapped_column(Float, default=25)
    clip_start: Mapped[float | None] = mapped_column(Float, nullable=True)
    clip_end: Mapped[float | None] = mapped_column(Float, nullable=True)
    cut_seq: Mapped[int] = mapped_column(Integer, default=0)
    source: Mapped[VideoSource] = mapped_column(Enum(VideoSource), default=VideoSource.NVR)
    acquired_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    acquired_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    analysis_fps: Mapped[str] = mapped_column(String(8), default="5")
    analysis_modes: Mapped[dict] = mapped_column(JSON, default=dict)
    analysis_version: Mapped[int] = mapped_column(Integer, default=0)
    analysis_engine: Mapped[str] = mapped_column(String(32), default="")
    alerts_count: Mapped[int] = mapped_column(Integer, default=0)
    thumb_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    demo_truth: Mapped[str | None] = mapped_column(String(512), nullable=True)  # sidecar for generated demo footage
    error: Mapped[str | None] = mapped_column(String(512), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    acquirer: Mapped[User] = relationship(foreign_keys=[acquired_by], lazy="joined")


class AnalysisJob(Base):
    __tablename__ = "analysis_jobs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    video_id: Mapped[str] = mapped_column(ForeignKey("videos.id"), index=True)
    kind: Mapped[JobKind] = mapped_column(Enum(JobKind), default=JobKind.ANALYZE)
    fps: Mapped[str] = mapped_column(String(8), default="5")
    modes: Mapped[dict] = mapped_column(JSON, default=dict)
    options: Mapped[dict] = mapped_column(JSON, default=dict)
    version: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[JobStatus] = mapped_column(Enum(JobStatus), default=JobStatus.QUEUED, index=True)
    progress: Mapped[float] = mapped_column(Float, default=0)
    engine: Mapped[str] = mapped_column(String(32), default="")
    result_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    worker_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    requested_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class WatchItem(Base):
    __tablename__ = "watch_items"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    kind: Mapped[WatchKind] = mapped_column(Enum(WatchKind))
    plate_pattern: Mapped[str | None] = mapped_column(String(20), nullable=True)
    plate_norm: Mapped[str | None] = mapped_column(String(20), nullable=True)
    name: Mapped[str] = mapped_column(String(255), default="")
    note: Mapped[str] = mapped_column(String(500), default="")
    ref_detection_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    creator: Mapped[User] = relationship(lazy="joined")
    images: Mapped[list["WatchImage"]] = relationship(lazy="selectin", cascade="all, delete-orphan")


class WatchImage(Base):
    __tablename__ = "watch_images"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    watch_item_id: Mapped[str] = mapped_column(ForeignKey("watch_items.id"), index=True)
    image_path: Mapped[str] = mapped_column(String(512))
    embedding: Mapped[list | None] = mapped_column(JSON, nullable=True)


class Detection(Base):
    __tablename__ = "detections"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    video_id: Mapped[str] = mapped_column(ForeignKey("videos.id"), index=True)
    analysis_version: Mapped[int] = mapped_column(Integer, default=1)
    track_id: Mapped[str] = mapped_column(String(20))
    kind: Mapped[DetKind] = mapped_column(Enum(DetKind))
    t_in: Mapped[float] = mapped_column(Float)
    t_out: Mapped[float] = mapped_column(Float)
    boxes: Mapped[list] = mapped_column(JSON, default=list)  # [{t,x,y,w,h}] in % of frame
    attributes: Mapped[dict] = mapped_column(JSON, default=dict)
    plate_text: Mapped[str | None] = mapped_column(String(20), nullable=True)
    plate_norm: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    plate_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    plate_alternatives: Mapped[list | None] = mapped_column(JSON, nullable=True)
    face_embedding: Mapped[list | None] = mapped_column(JSON, nullable=True)
    confidence: Mapped[float] = mapped_column(Float)
    path: Mapped[list] = mapped_column(JSON, default=list)  # [{camera_id, time}] after re-ID
    reid_key: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    watch_item_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    alerted: Mapped[bool] = mapped_column(Boolean, default=False)
    source_detection_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    crop_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    face_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    __table_args__ = (Index("ix_det_video_version", "video_id", "analysis_version"),)


class WatchHit(Base):
    """One alert per (detection, watch item) pair (UR-WATCH-03)."""

    __tablename__ = "watch_hits"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    detection_id: Mapped[str] = mapped_column(String(36))
    watch_item_id: Mapped[str] = mapped_column(String(36))
    similarity: Mapped[float] = mapped_column(Float, default=100)
    alerted: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    __table_args__ = (UniqueConstraint("detection_id", "watch_item_id"),)


class Zone(Base):
    __tablename__ = "zones"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    code: Mapped[str] = mapped_column(String(12), default="")
    video_id: Mapped[str] = mapped_column(ForeignKey("videos.id"), index=True)
    case_id: Mapped[str] = mapped_column(ForeignKey("cases.id"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    polygon: Mapped[list] = mapped_column(JSON)  # [[x,y], ...] in %
    people: Mapped[bool] = mapped_column(Boolean, default=True)
    vehicles: Mapped[bool] = mapped_column(Boolean, default=True)
    analyzed_version: Mapped[int] = mapped_column(Integer, default=0)  # 0 = waiting for video analysis
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class ZoneHit(Base):
    __tablename__ = "zone_hits"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    zone_id: Mapped[str] = mapped_column(ForeignKey("zones.id"), index=True)
    detection_id: Mapped[str] = mapped_column(String(36))
    enter_t: Mapped[float] = mapped_column(Float)
    exit_t: Mapped[float] = mapped_column(Float)


class Tag(Base):
    __tablename__ = "tags"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    case_id: Mapped[str] = mapped_column(ForeignKey("cases.id"), index=True)
    video_id: Mapped[str] = mapped_column(ForeignKey("videos.id"), index=True)
    detection_id: Mapped[str | None] = mapped_column(String(36), nullable=True, unique=True)
    t: Mapped[float] = mapped_column(Float, default=0)
    color: Mapped[str] = mapped_column(String(10), default="red")
    note: Mapped[str] = mapped_column(String(500), default="")
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Snapshot(Base):
    __tablename__ = "snapshots"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    case_id: Mapped[str] = mapped_column(ForeignKey("cases.id"), index=True)
    video_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    t: Mapped[float] = mapped_column(Float, default=0)
    image_path: Mapped[str] = mapped_column(String(512))
    annotations: Mapped[list] = mapped_column(JSON, default=list)
    score: Mapped[float] = mapped_column(Float, default=0)
    counts: Mapped[dict] = mapped_column(JSON, default=dict)
    uploaded: Mapped[bool] = mapped_column(Boolean, default=False)
    in_report: Mapped[bool] = mapped_column(Boolean, default=False)
    sha256: Mapped[str] = mapped_column(String(64), default="")
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class DerivedFile(Base):
    """Processed images, enhanced videos: always separate files linked to their source (UR-EVD-09)."""

    __tablename__ = "derived_files"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    case_id: Mapped[str] = mapped_column(ForeignKey("cases.id"), index=True)
    kind: Mapped[str] = mapped_column(String(24))  # processed_image | enhanced_video
    source_video_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    source_snapshot_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    file_name: Mapped[str] = mapped_column(String(255))
    path: Mapped[str] = mapped_column(String(512))
    sha256: Mapped[str] = mapped_column(String(64), default="")
    params: Mapped[dict] = mapped_column(JSON, default=dict)
    in_report: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Report(Base):
    __tablename__ = "reports"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    case_id: Mapped[str] = mapped_column(ForeignKey("cases.id"), index=True)
    file_name: Mapped[str] = mapped_column(String(255))
    path: Mapped[str] = mapped_column(String(512))
    sha256: Mapped[str] = mapped_column(String(64))
    results_count: Mapped[int] = mapped_column(Integer, default=0)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class ExportPackage(Base):
    __tablename__ = "export_packages"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    case_id: Mapped[str] = mapped_column(ForeignKey("cases.id"), index=True)
    file_name: Mapped[str] = mapped_column(String(255))
    path: Mapped[str] = mapped_column(String(512))
    sha256: Mapped[str] = mapped_column(String(64))
    size_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    file_count: Mapped[int] = mapped_column(Integer, default=0)
    parts: Mapped[dict] = mapped_column(JSON, default=dict)
    files: Mapped[list] = mapped_column(JSON, default=list)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class AuditLog(Base):
    """Append-only, hash-chained chain-of-custody log (UR-AUD-01, NFR-SEC-03)."""

    __tablename__ = "audit_logs"
    seq: Mapped[int] = mapped_column(BIGPK, primary_key=True, autoincrement=True)
    at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)  # None = Hệ thống
    actor: Mapped[str] = mapped_column(String(128))
    action: Mapped[str] = mapped_column(String(48), index=True)
    object: Mapped[str] = mapped_column(String(1000), default="")
    case_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    ip: Mapped[str] = mapped_column(String(64), default="")
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    prev_hash: Mapped[str] = mapped_column(String(64))
    hash: Mapped[str] = mapped_column(String(64))


class Notification(Base):
    __tablename__ = "notifications"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    kind: Mapped[str] = mapped_column(String(32))
    tone: Mapped[str] = mapped_column(String(12), default="accent")  # ok | warn | danger | accent
    title_vi: Mapped[str] = mapped_column(String(500))
    title_en: Mapped[str] = mapped_column(String(500))
    body_vi: Mapped[str] = mapped_column(String(1000), default="")
    body_en: Mapped[str] = mapped_column(String(1000), default="")
    link: Mapped[dict] = mapped_column(JSON, default=dict)
    unread: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class Event(Base):
    """Realtime bus: workers append rows, the API relays them to WebSocket clients."""

    __tablename__ = "events"
    id: Mapped[int] = mapped_column(BIGPK, primary_key=True, autoincrement=True)
    user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)  # None = everyone
    type: Mapped[str] = mapped_column(String(48))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class UploadSession(Base):
    __tablename__ = "upload_sessions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    video_id: Mapped[str] = mapped_column(String(36))
    user_id: Mapped[str] = mapped_column(String(36))
    file_name: Mapped[str] = mapped_column(String(255))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    received_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    tmp_path: Mapped[str] = mapped_column(String(512))
    status: Mapped[str] = mapped_column(String(16), default="OPEN")  # OPEN | DONE | FAILED
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class FaceQuery(Base):
    """Query photos are kept with the audit trail (UR-SRCH-03)."""

    __tablename__ = "face_queries"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    same_person: Mapped[bool] = mapped_column(Boolean, default=True)
    images: Mapped[list] = mapped_column(JSON, default=list)  # [{path, embedding}]
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
