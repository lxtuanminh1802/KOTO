from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="VMA_", extra="ignore")

    database_url: str = "mysql+pymysql://vma:vma@127.0.0.1:3306/vma?charset=utf8mb4"
    data_dir: Path = Path("./data")

    jwt_secret: str = "change-me-in-production-please-32b+"
    access_ttl_minutes: int = 15
    session_ttl_hours: int = 8
    media_ttl_hours: int = 8

    # Demo mode accepts OTP 000000 and exposes demo account hints on the login screen.
    demo_mode: bool = True

    # Analysis engine: "simulated" (default) or "opencv" (classic CV, real boxes, no OCR).
    ai_engine: str = "simulated"
    # Run the analysis worker inside the API process (handy for local dev).
    worker_embedded: bool = False
    worker_poll_seconds: float = 1.0
    worker_concurrency: int = 2
    # Simulated engine pacing multiplier (0 = instant).
    sim_speed: float = 1.0
    integrity_check_hours: int = 168  # UR-EVD-09 weekly re-hash
    audit_check_hours: int = 24  # NFR-SEC-03 daily chain check
    # Clip files: "copy" cuts on keyframes without re-encoding (Q08), "reencode" is frame accurate.
    clip_mode: str = "copy"

    max_upload_bytes: int = 4 * 1024**3
    upload_chunk_bytes: int = 8 * 1024**2
    max_files_per_batch: int = 20

    face_search_threshold: int = 60  # Q03
    face_alert_threshold: int = 85  # Q03
    plate_low_confidence: int = 70

    login_max_failures: int = 5
    login_lock_minutes: int = 15
    pin_max_failures: int = 5

    maptiler_key: str = "HlF0fvzCCBtMA9sGgBww"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    ffmpeg: str = "ffmpeg"
    ffprobe: str = "ffprobe"

    @property
    def evidence_dir(self) -> Path:
        return self.data_dir / "evidence"

    @property
    def derived_dir(self) -> Path:
        return self.data_dir / "derived"

    @property
    def upload_tmp_dir(self) -> Path:
        return self.data_dir / "uploads"

    @property
    def export_dir(self) -> Path:
        return self.data_dir / "exports"


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    for d in (s.evidence_dir, s.derived_dir, s.upload_tmp_dir, s.export_dir):
        d.mkdir(parents=True, exist_ok=True)
    return s
