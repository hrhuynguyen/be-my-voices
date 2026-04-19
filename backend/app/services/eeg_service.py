from __future__ import annotations

import importlib.util
import math
import threading
from collections import deque
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Literal

import numpy as np
from scipy.signal import butter, filtfilt, iirnotch, sosfiltfilt, welch

from app.core.config import settings
from app.schemas.eeg import (
    ConnectMuseRequest,
    EEGDebugResponse,
    EEGFeatureSnapshot,
    EEGProvider,
    EEGScores,
    EEGTelemetryResponse,
    TonePolicy,
)

CHANNEL_NAMES = ["TP9", "AF7", "AF8", "TP10"]
DEFAULT_SAMPLE_RATE_HZ = 128
EEG_BANDS: dict[str, tuple[float, float]] = {
    "delta": (1.0, 4.0),
    "theta": (4.0, 8.0),
    "alpha": (8.0, 13.0),
    "beta": (13.0, 30.0),
    "gamma": (30.0, 45.0),
}
BANDPASS_LOW_HZ = 1.0
BANDPASS_HIGH_HZ = 40.0
BANDPASS_ORDER = 4
NOTCH_HZ = 60.0
NOTCH_QUALITY = 30.0
DEAD_CHANNEL_VARIANCE = 1e-6
STACK_STATUS = {
    "muselsl": importlib.util.find_spec("muselsl") is not None,
    "pylsl": importlib.util.find_spec("pylsl") is not None,
    "mne": importlib.util.find_spec("mne") is not None,
    "neurokit2": importlib.util.find_spec("neurokit2") is not None,
    "mne_features": importlib.util.find_spec("mne_features") is not None,
}
ConnectionState = Literal["disconnected", "connecting", "connected", "error"]
_UNSET = object()


class EEGServiceError(RuntimeError):
    pass


@dataclass
class _FeatureState:
    band_powers: dict[str, dict[str, float]] = field(default_factory=dict)
    mean_amplitude: dict[str, float] = field(default_factory=dict)
    variance: dict[str, float] = field(default_factory=dict)
    frontal_alpha_asymmetry: float | None = None
    signal_quality: float = 0.0
    usable_channels: set[str] = field(default_factory=set)


@dataclass
class _TelemetryState:
    provider: EEGProvider = "lsl"
    connection_state: ConnectionState = "disconnected"
    device_name: str = "Muse 2"
    stream_alive: bool = False
    sample_rate_hz: int = DEFAULT_SAMPLE_RATE_HZ
    channel_names: list[str] = field(default_factory=lambda: CHANNEL_NAMES.copy())
    sample_name: str | None = None
    tone_policy: TonePolicy | None = None
    scores: EEGScores | None = None
    features: _FeatureState | None = None
    last_sample_at: datetime | None = None
    last_window_at: datetime | None = None
    last_error: str | None = None
    status_message: str = "Muse 2 is disconnected."


_state = _TelemetryState(provider="lsl")
_lock = threading.Lock()
_stop_event = threading.Event()
_worker_thread: threading.Thread | None = None
_recent_events: list[str] = []

_filter_cache: dict[int, tuple[np.ndarray, np.ndarray, np.ndarray]] = {}
_baseline_buffers: dict[str, deque[float]] = {
    "stress_index": deque(maxlen=settings.eeg_baseline_window_count),
    "arousal_index": deque(maxlen=settings.eeg_baseline_window_count),
    "faa": deque(maxlen=settings.eeg_baseline_window_count),
}
_ema_scores: dict[str, float | None] = {
    "stress": None,
    "valence": None,
    "arousal": None,
}
_tone_hysteresis: dict[str, object] = {
    "last_policy": None,
    "candidate": None,
    "votes": 0,
}


def _reset_analysis_state() -> None:
    with _lock:
        for key in _baseline_buffers:
            _baseline_buffers[key].clear()
        for key in _ema_scores:
            _ema_scores[key] = None
        _tone_hysteresis["last_policy"] = None
        _tone_hysteresis["candidate"] = None
        _tone_hysteresis["votes"] = 0
        _tone_history.clear()


def _get_filters(
    sample_rate_hz: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    cached = _filter_cache.get(sample_rate_hz)
    if cached is not None:
        return cached
    nyquist = sample_rate_hz / 2.0
    low = BANDPASS_LOW_HZ / nyquist
    high = min(BANDPASS_HIGH_HZ, nyquist - 1.0) / nyquist
    sos = butter(BANDPASS_ORDER, [low, high], btype="bandpass", output="sos")
    notch_freq = NOTCH_HZ / nyquist
    if notch_freq >= 1.0:
        notch_b = np.array([1.0])
        notch_a = np.array([1.0])
    else:
        notch_b, notch_a = iirnotch(notch_freq, NOTCH_QUALITY)
    _filter_cache[sample_rate_hz] = (sos, notch_b, notch_a)
    return _filter_cache[sample_rate_hz]


def _preprocess(channel: np.ndarray, sample_rate_hz: int) -> np.ndarray:
    if channel.size == 0:
        return channel
    centered = channel - float(np.mean(channel))
    sos, notch_b, notch_a = _get_filters(sample_rate_hz)
    min_padlen = 3 * BANDPASS_ORDER * 2
    if centered.size <= min_padlen:
        return centered
    try:
        filtered = sosfiltfilt(sos, centered)
        if notch_b.size > 1:
            filtered = filtfilt(notch_b, notch_a, filtered)
        return filtered
    except ValueError:
        return centered


def _welch_band_powers(
    channel: np.ndarray, sample_rate_hz: int
) -> dict[str, float]:
    if channel.size < 8:
        return {band: 0.0 for band in EEG_BANDS}
    nperseg = min(channel.size, max(32, sample_rate_hz))
    freqs, psd = welch(channel, fs=sample_rate_hz, nperseg=nperseg)
    powers: dict[str, float] = {}
    for band_name, (low_hz, high_hz) in EEG_BANDS.items():
        mask = (freqs >= low_hz) & (freqs < high_hz)
        if not np.any(mask):
            powers[band_name] = 0.0
            continue
        powers[band_name] = float(np.trapezoid(psd[mask], freqs[mask]))
    return powers


def _channel_peaks(by_channel: dict[str, np.ndarray]) -> dict[str, float]:
    peaks: dict[str, float] = {}
    for name, values in by_channel.items():
        if values.size < 8:
            continue
        trim = max(values.size // 8, 1)
        trimmed = values[trim:-trim] if values.size > 2 * trim else values
        peaks[name] = float(np.max(trimmed) - np.min(trimmed))
    return peaks


def _is_artifact_window(by_channel: dict[str, np.ndarray]) -> bool:
    threshold = settings.eeg_artifact_peak_to_peak_uv
    peaks = _channel_peaks(by_channel)
    if not peaks:
        return False
    bad = [name for name, value in peaks.items() if value > threshold]
    if len(bad) >= 2:
        _log_event(
            "Artifact reject: "
            + ", ".join(f"{name}={value:.0f}" for name, value in peaks.items())
        )
        return True
    return False


def _noisy_channels(by_channel: dict[str, np.ndarray]) -> set[str]:
    threshold = settings.eeg_artifact_peak_to_peak_uv
    return {
        name
        for name, value in _channel_peaks(by_channel).items()
        if value > threshold
    }


def _live_channels(by_channel: dict[str, np.ndarray]) -> set[str]:
    live: set[str] = set()
    for name, values in by_channel.items():
        if values.size == 0:
            continue
        if float(np.var(values)) > DEAD_CHANNEL_VARIANCE:
            live.add(name)
    return live


def _update_baseline(key: str, value: float) -> float:
    buffer = _baseline_buffers[key]
    buffer.append(value)
    if len(buffer) < settings.eeg_baseline_min_samples:
        return 0.0
    arr = np.array(buffer, dtype=float)
    mean = float(np.mean(arr))
    std = float(np.std(arr))
    if std < 1e-6:
        return 0.0
    return (value - mean) / std


def _ema(key: str, value: float) -> float:
    alpha = settings.eeg_score_ema_alpha
    previous = _ema_scores[key]
    if previous is None:
        _ema_scores[key] = value
        return value
    smoothed = alpha * value + (1.0 - alpha) * previous
    _ema_scores[key] = smoothed
    return smoothed


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _isoformat(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _log_event(message: str) -> None:
    timestamp = _utcnow().strftime("%H:%M:%S")
    with _lock:
        _recent_events.append(f"{timestamp} {message}")
        del _recent_events[:-settings.eeg_debug_log_limit]


def _clamp(value: float, lower: float, upper: float) -> float:
    return min(max(value, lower), upper)


def _sigmoid(value: float) -> float:
    return 1.0 / (1.0 + math.exp(-value))


def _stop_worker() -> None:
    global _worker_thread
    _stop_event.set()
    worker = _worker_thread
    if worker and worker.is_alive():
        worker.join(timeout=2.0)
    _worker_thread = None
    _stop_event.clear()


def _set_state(
    *,
    provider: EEGProvider | object = _UNSET,
    connection_state: ConnectionState | object = _UNSET,
    stream_alive: bool | object = _UNSET,
    sample_rate_hz: int | object = _UNSET,
    sample_name: str | None | object = _UNSET,
    tone_policy: TonePolicy | None | object = _UNSET,
    scores: EEGScores | None | object = _UNSET,
    features: _FeatureState | None | object = _UNSET,
    last_sample_at: datetime | None | object = _UNSET,
    last_window_at: datetime | None | object = _UNSET,
    last_error: str | None | object = _UNSET,
    status_message: str | object = _UNSET,
) -> None:
    with _lock:
        if provider is not _UNSET:
            _state.provider = provider
        if connection_state is not _UNSET:
            _state.connection_state = connection_state
        if stream_alive is not _UNSET:
            _state.stream_alive = stream_alive
        if sample_rate_hz is not _UNSET:
            _state.sample_rate_hz = sample_rate_hz
        if sample_name is not _UNSET:
            _state.sample_name = sample_name
        if tone_policy is not _UNSET:
            _state.tone_policy = tone_policy
        if scores is not _UNSET:
            _state.scores = scores
        if features is not _UNSET:
            _state.features = features
        if last_sample_at is not _UNSET:
            _state.last_sample_at = last_sample_at
        if last_window_at is not _UNSET:
            _state.last_window_at = last_window_at
        if last_error is not _UNSET:
            _state.last_error = last_error
        if status_message is not _UNSET:
            _state.status_message = status_message


def _reset_state(provider: EEGProvider) -> None:
    with _lock:
        _state.provider = provider
        _state.connection_state = "disconnected"
        _state.stream_alive = False
        _state.sample_rate_hz = DEFAULT_SAMPLE_RATE_HZ
        _state.sample_name = None
        _state.tone_policy = None
        _state.scores = None
        _state.features = None
        _state.last_sample_at = None
        _state.last_window_at = None
        _state.last_error = None
        _state.status_message = "Muse 2 is disconnected."
    _reset_analysis_state()


def _snapshot() -> EEGTelemetryResponse:
    with _lock:
        features = None
        if _state.features is not None:
            features = EEGFeatureSnapshot(
                band_powers=_state.features.band_powers,
                mean_amplitude=_state.features.mean_amplitude,
                variance=_state.features.variance,
                frontal_alpha_asymmetry=_state.features.frontal_alpha_asymmetry,
                signal_quality=_state.features.signal_quality,
            )

        telemetry = EEGTelemetryResponse(
            provider=_state.provider,
            connection_state=_state.connection_state,
            device_name=_state.device_name,
            stream_alive=_state.stream_alive,
            eeg_assisted_tone_available=bool(
                _state.stream_alive and _state.tone_policy and _state.scores
            ),
            sample_rate_hz=_state.sample_rate_hz,
            window_seconds=settings.eeg_window_seconds,
            channel_names=_state.channel_names.copy(),
            sample_name=_state.sample_name,
            tone_policy=_state.tone_policy,
            scores=_state.scores,
            features=features,
            last_sample_at=_isoformat(_state.last_sample_at),
            last_window_at=_isoformat(_state.last_window_at),
            last_error=_state.last_error,
            status_message=_state.status_message,
            stack_status=STACK_STATUS.copy(),
        )
    return telemetry


def _window_by_channel(
    window: list[list[float]],
) -> dict[str, np.ndarray]:
    if not window:
        return {name: np.zeros(0, dtype=float) for name in CHANNEL_NAMES}
    matrix = np.zeros((len(window), len(CHANNEL_NAMES)), dtype=float)
    for row_index, sample in enumerate(window):
        for col_index in range(len(CHANNEL_NAMES)):
            matrix[row_index, col_index] = (
                float(sample[col_index]) if col_index < len(sample) else 0.0
            )
    return {
        name: matrix[:, index] for index, name in enumerate(CHANNEL_NAMES)
    }


def _extract_features(
    window: list[list[float]], sample_rate_hz: int
) -> _FeatureState | None:
    raw_by_channel = _window_by_channel(window)
    filtered_by_channel: dict[str, np.ndarray] = {
        name: _preprocess(values, sample_rate_hz)
        for name, values in raw_by_channel.items()
    }
    if _is_artifact_window(filtered_by_channel):
        return None

    band_powers: dict[str, dict[str, float]] = {}
    mean_amplitude: dict[str, float] = {}
    variance: dict[str, float] = {}

    for channel_name, values in filtered_by_channel.items():
        band_powers[channel_name] = _welch_band_powers(values, sample_rate_hz)
        if values.size == 0:
            mean_amplitude[channel_name] = 0.0
            variance[channel_name] = 0.0
        else:
            mean_amplitude[channel_name] = float(np.mean(np.abs(values)))
            variance[channel_name] = float(np.var(values))

    noisy = _noisy_channels(filtered_by_channel)
    live = _live_channels(filtered_by_channel) - noisy
    left_alpha = band_powers.get("AF7", {}).get("alpha", 0.0) if "AF7" in live else 0.0
    right_alpha = band_powers.get("AF8", {}).get("alpha", 0.0) if "AF8" in live else 0.0
    reference = max(left_alpha, right_alpha, 1e-6)
    epsilon = reference * 1e-3
    if "AF7" in live and "AF8" in live:
        frontal_alpha_asymmetry = math.log(right_alpha + epsilon) - math.log(
            left_alpha + epsilon
        )
    else:
        frontal_alpha_asymmetry = None

    average_variance = (
        sum(variance[name] for name in live) / len(live) if live else 0.0
    )
    normalized_variance = min(average_variance / 100.0, 1.0)
    signal_quality = _clamp(
        1.0 - normalized_variance * 0.6, 0.1, 1.0
    )

    return _FeatureState(
        band_powers=band_powers,
        mean_amplitude=mean_amplitude,
        variance=variance,
        frontal_alpha_asymmetry=frontal_alpha_asymmetry,
        signal_quality=signal_quality,
        usable_channels=live,
    )


def _frontal_average(features: _FeatureState, band: str) -> float:
    values: list[float] = []
    for channel in ("AF7", "AF8"):
        if channel not in features.usable_channels:
            continue
        values.append(features.band_powers.get(channel, {}).get(band, 0.0))
    if not values:
        return 0.0
    return sum(values) / len(values)


def _infer_scores(features: _FeatureState) -> EEGScores:
    frontal_beta = _frontal_average(features, "beta")
    frontal_alpha = _frontal_average(features, "alpha")
    frontal_theta = _frontal_average(features, "theta")
    epsilon = 1e-6
    stress_index = frontal_beta / (frontal_alpha + frontal_theta + epsilon)
    arousal_index = frontal_beta / (frontal_alpha + epsilon)
    faa_raw = features.frontal_alpha_asymmetry or 0.0

    stress_z = _update_baseline("stress_index", stress_index)
    arousal_z = _update_baseline("arousal_index", arousal_index)
    faa_z = _update_baseline("faa", faa_raw)

    stress_raw = _clamp(_sigmoid(stress_z * 1.6), 0.0, 1.0)
    arousal_raw = _clamp(_sigmoid(arousal_z * 1.6), 0.0, 1.0)
    valence_raw = _clamp(0.5 + faa_z * 0.35, 0.0, 1.0)

    stress = _clamp(_ema("stress", stress_raw), 0.0, 1.0)
    arousal = _clamp(_ema("arousal", arousal_raw), 0.0, 1.0)
    valence = _clamp(_ema("valence", valence_raw), 0.0, 1.0)
    return EEGScores(stress=stress, valence=valence, arousal=arousal)


def _raw_tone_policy(scores: EEGScores) -> TonePolicy:
    if scores.stress >= 0.60 or (scores.arousal >= 0.62 and scores.valence <= 0.5):
        return "urgent"
    if scores.stress >= 0.45 or scores.arousal >= 0.52:
        return "stressed"
    if scores.arousal <= 0.42 and scores.valence >= 0.52:
        return "calm"
    return "neutral"


def _map_tone_policy(scores: EEGScores) -> TonePolicy:
    candidate = _raw_tone_policy(scores)
    last = _tone_hysteresis["last_policy"]
    if last is None or candidate == last:
        _tone_hysteresis["last_policy"] = candidate
        _tone_hysteresis["candidate"] = candidate
        _tone_hysteresis["votes"] = 0
        return candidate

    required = (
        settings.eeg_tone_hysteresis_votes
        if candidate == "neutral"
        else 1
    )
    if _tone_hysteresis["candidate"] == candidate:
        _tone_hysteresis["votes"] = int(_tone_hysteresis["votes"]) + 1
    else:
        _tone_hysteresis["candidate"] = candidate
        _tone_hysteresis["votes"] = 1
    if int(_tone_hysteresis["votes"]) >= required:
        _tone_hysteresis["last_policy"] = candidate
        _tone_hysteresis["votes"] = 0
        return candidate
    return last  # type: ignore[return-value]


_TONE_RANK: dict[TonePolicy, int] = {
    "neutral": 0,
    "calm": 1,
    "stressed": 2,
    "urgent": 3,
}
_tone_history: deque[tuple[datetime, TonePolicy]] = deque()


def _record_tone(policy: TonePolicy) -> None:
    now = _utcnow()
    _tone_history.append((now, policy))
    cutoff_seconds = settings.eeg_tone_hold_seconds
    while (
        _tone_history
        and (now - _tone_history[0][0]).total_seconds() > cutoff_seconds
    ):
        _tone_history.popleft()


def _dominant_recent_tone() -> TonePolicy | None:
    if not _tone_history:
        return None
    peak: TonePolicy = "neutral"
    for _, policy in _tone_history:
        if _TONE_RANK[policy] > _TONE_RANK[peak]:
            peak = policy
    return peak


def _update_window(window: list[list[float]], sample_rate_hz: int) -> None:
    now = _utcnow()
    features = _extract_features(window, sample_rate_hz)
    if features is None:
        _set_state(
            connection_state="connected",
            stream_alive=True,
            sample_rate_hz=sample_rate_hz,
            last_sample_at=now,
            status_message="Muse telemetry active. Artifact detected, window skipped.",
        )
        return
    scores = _infer_scores(features)
    tone_policy = _map_tone_policy(scores)
    _record_tone(tone_policy)
    _set_state(
        connection_state="connected",
        stream_alive=True,
        sample_rate_hz=sample_rate_hz,
        scores=scores,
        features=features,
        tone_policy=tone_policy,
        last_sample_at=now,
        last_window_at=now,
        last_error=None,
        status_message=f"Muse telemetry active. Tone policy is {tone_policy}.",
    )


def _run_lsl_worker(stream_name: str) -> None:
    if not STACK_STATUS["pylsl"]:
        _set_state(
            provider="lsl",
            connection_state="error",
            stream_alive=False,
            last_error="pylsl is not installed. Install the EEG extras and start a Muse LSL stream.",
            status_message="Unable to connect to Muse 2. pylsl is not installed.",
        )
        _log_event("LSL connection failed because pylsl is unavailable.")
        return

    _log_event(f"Starting live LSL worker for stream '{stream_name}'.")

    try:
        from pylsl import StreamInlet, resolve_byprop, resolve_streams  # type: ignore
    except Exception as exc:  # pragma: no cover - optional dependency branch
        _set_state(
            provider="lsl",
            connection_state="error",
            stream_alive=False,
            last_error=f"Unable to import pylsl: {exc}",
            status_message="Unable to import pylsl for Muse 2 streaming.",
        )
        _log_event(f"LSL import failed: {exc}")
        return

    _set_state(
        provider="lsl",
        connection_state="connecting",
        stream_alive=False,
        sample_name=None,
        status_message=f"Searching for Muse LSL stream '{stream_name}'.",
        last_error=None,
    )

    try:  # pragma: no cover - optional dependency branch
        streams = resolve_byprop("name", stream_name, timeout=6.0)
        if not streams:
            streams = resolve_byprop("type", "EEG", timeout=6.0)
        if not streams:
            discovered_streams = resolve_streams(wait_time=2.0)
            if discovered_streams:
                _log_event(
                    "Discovered LSL streams: "
                    + ", ".join(
                        f"{stream.name()}[{stream.type()}]"
                        for stream in discovered_streams
                    )
                )
                streams = [
                    stream
                    for stream in discovered_streams
                    if stream.type().strip().upper() == "EEG"
                    or "MUSE" in stream.name().strip().upper()
                    or "MUSE" in (stream.source_id() or "").strip().upper()
                ]
        if not streams:
            raise EEGServiceError(
                f"No Muse EEG stream found. Start muselsl and expose '{stream_name}' over LSL."
            )

        selected_stream = streams[0]
        inlet = StreamInlet(selected_stream)
        info = inlet.info()
        resolved_name = info.name() or selected_stream.name() or stream_name
        sample_rate_hz = int(info.nominal_srate() or DEFAULT_SAMPLE_RATE_HZ)
        channel_count = int(info.channel_count() or len(CHANNEL_NAMES))
        _set_state(
            connection_state="connected",
            stream_alive=True,
            sample_rate_hz=sample_rate_hz,
            sample_name=resolved_name,
            status_message=f"Muse 2 connected over LSL via '{resolved_name}'.",
        )
        _log_event(
            f"Muse LSL stream connected: name='{resolved_name}', type='{info.type() or selected_stream.type()}', channels={channel_count}, sample_rate={sample_rate_hz}."
        )

        samples_buffer: list[list[float]] = []
        window_size = max(8, int(sample_rate_hz * settings.eeg_window_seconds))
        hop_size = max(8, int(sample_rate_hz * settings.eeg_hop_seconds))
        samples_since_emit = 0

        while not _stop_event.is_set():
            chunk, _timestamps = inlet.pull_chunk(timeout=0.2, max_samples=hop_size)
            if not chunk:
                if (
                    _state.last_sample_at
                    and (_utcnow() - _state.last_sample_at).total_seconds()
                    > settings.eeg_signal_timeout_seconds
                ):
                    _set_state(
                        stream_alive=False,
                        status_message="Muse stream connected but no recent samples arrived.",
                    )
                continue

            for row in chunk:
                samples_buffer.append(
                    [float(value) for value in row[: min(channel_count, len(CHANNEL_NAMES))]]
                )
            _set_state(last_sample_at=_utcnow(), stream_alive=True)

            if len(samples_buffer) > window_size * 2:
                samples_buffer = samples_buffer[-window_size:]

            samples_since_emit += len(chunk)
            if (
                len(samples_buffer) >= window_size
                and samples_since_emit >= hop_size
            ):
                window = samples_buffer[-window_size:]
                _update_window(window, sample_rate_hz)
                samples_since_emit = 0

    except Exception as exc:  # pragma: no cover - optional dependency branch
        _set_state(
            provider="lsl",
            connection_state="error",
            stream_alive=False,
            last_error=str(exc),
            status_message="Muse 2 connection failed.",
        )
        _log_event(f"LSL worker failed: {exc}")


def connect_device(request: ConnectMuseRequest | None = None) -> EEGTelemetryResponse:
    if not settings.eeg_enabled:
        raise EEGServiceError("EEG support is disabled in backend settings.")

    _stop_worker()
    _reset_state("lsl")
    _set_state(
        provider="lsl",
        connection_state="connecting",
        status_message="Connecting to Muse 2...",
    )

    global _worker_thread
    _worker_thread = threading.Thread(
        target=lambda: _run_lsl_worker(settings.eeg_muse_stream_name),
        name="eeg-lsl-worker",
        daemon=True,
    )
    _worker_thread.start()
    return get_telemetry()


def disconnect_device() -> EEGTelemetryResponse:
    _stop_worker()
    _reset_state(_state.provider)
    _log_event("Muse device disconnected.")
    return get_telemetry()


def check_connection() -> EEGTelemetryResponse:
    telemetry = get_telemetry()
    if telemetry.connection_state == "connected" and telemetry.stream_alive:
        return telemetry

    if telemetry.provider == "lsl" and telemetry.connection_state != "connecting":
        _set_state(
            connection_state="error",
            stream_alive=False,
            status_message="Muse 2 is not streaming. Check muselsl and the device connection.",
        )
    return get_telemetry()


def get_telemetry() -> EEGTelemetryResponse:
    telemetry = _snapshot()
    if (
        telemetry.connection_state == "connected"
        and telemetry.last_sample_at
        and _state.last_sample_at
        and (_utcnow() - _state.last_sample_at).total_seconds()
        > settings.eeg_signal_timeout_seconds
    ):
        _set_state(
            stream_alive=False,
            status_message="Muse telemetry timed out. Check the device stream.",
        )
        telemetry = _snapshot()
    return telemetry


def get_debug_snapshot() -> EEGDebugResponse:
    return EEGDebugResponse(
        telemetry=get_telemetry(),
        recent_events=_recent_events.copy(),
        debug_flags={
            "lsl_stream_name": settings.eeg_muse_stream_name,
            "window_seconds": str(settings.eeg_window_seconds),
            "stack_mode": (
                "full"
                if all(STACK_STATUS.values())
                else "fallback"
            ),
        },
    )


def get_current_tone_policy() -> TonePolicy | None:
    telemetry = get_telemetry()
    if not telemetry.eeg_assisted_tone_available:
        return None
    dominant = _dominant_recent_tone()
    return dominant or telemetry.tone_policy
