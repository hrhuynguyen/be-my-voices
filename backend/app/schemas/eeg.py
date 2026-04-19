from typing import Literal

from pydantic import BaseModel, Field

ConnectionState = Literal[
    "disconnected",
    "connecting",
    "connected",
    "error",
]
EEGProvider = Literal["lsl"]
TonePolicy = Literal["calm", "neutral", "stressed", "urgent"]


class ConnectMuseRequest(BaseModel):
    mode: EEGProvider | None = None


class EEGScores(BaseModel):
    stress: float = Field(ge=0.0, le=1.0)
    valence: float = Field(ge=0.0, le=1.0)
    arousal: float = Field(ge=0.0, le=1.0)


class EEGFeatureSnapshot(BaseModel):
    band_powers: dict[str, dict[str, float]]
    mean_amplitude: dict[str, float]
    variance: dict[str, float]
    frontal_alpha_asymmetry: float | None = None
    signal_quality: float = Field(ge=0.0, le=1.0)


class EEGTelemetryResponse(BaseModel):
    experimental: bool = True
    provider: EEGProvider
    connection_state: ConnectionState
    device_name: str
    stream_alive: bool
    eeg_assisted_tone_available: bool
    sample_rate_hz: int
    window_seconds: float
    channel_names: list[str]
    sample_name: str | None = None
    tone_policy: TonePolicy | None = None
    scores: EEGScores | None = None
    features: EEGFeatureSnapshot | None = None
    last_sample_at: str | None = None
    last_window_at: str | None = None
    last_error: str | None = None
    status_message: str
    stack_status: dict[str, bool]


class EEGDebugResponse(BaseModel):
    telemetry: EEGTelemetryResponse
    recent_events: list[str]
    debug_flags: dict[str, str]

