from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings

BASE_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    database_url: str = Field(...)
    openai_api_key: str | None = Field(default=None)
    gemini_api_key: str = Field(...)
    elevenlabs_api_key: str = Field(...)
    eeg_enabled: bool = Field(default=True)
    eeg_muse_stream_name: str = Field(default="Muse")
    eeg_window_seconds: float = Field(default=3.0)
    eeg_hop_seconds: float = Field(default=0.5)
    eeg_signal_timeout_seconds: float = Field(default=12.0)
    eeg_debug_log_limit: int = Field(default=80)
    eeg_artifact_peak_to_peak_uv: float = Field(default=1500.0)
    eeg_baseline_window_count: int = Field(default=20)
    eeg_baseline_min_samples: int = Field(default=5)
    eeg_score_ema_alpha: float = Field(default=0.18)
    eeg_tone_hysteresis_votes: int = Field(default=4)
    eeg_tone_hold_seconds: float = Field(default=15.0)
    cors_origins: str = Field(
        default="http://localhost:5173,http://localhost:4173"
    )

    model_config = {
        "env_file": str(BASE_DIR / ".env"),
        "env_file_encoding": "utf-8",
    }

    @property
    def cors_origin_list(self) -> list[str]:
        return [
            origin.strip()
            for origin in self.cors_origins.split(",")
            if origin.strip()
        ]


settings = Settings()
