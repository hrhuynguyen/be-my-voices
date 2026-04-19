import io
from pathlib import Path

import httpx
import pytest
from sqlmodel import select

from app.models.session import Session as SessionModel
from app.services import (
    eeg_service,
    elevenlabs_service,
    gemini_service,
    speech_service,
    whisper_service,
)


@pytest.fixture
def audio_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(speech_service, "AUDIO_DIR", tmp_path)
    return tmp_path


@pytest.fixture
def mock_services(monkeypatch: pytest.MonkeyPatch) -> dict:
    calls: dict = {}

    def fake_isolate(audio_bytes: bytes, filename: str = "audio.webm") -> bytes:
        calls["isolator"] = {"audio": audio_bytes, "filename": filename}
        return b"clean-audio"

    def fake_transcribe(audio_bytes: bytes, filename: str = "audio.webm") -> str:
        calls["whisper"] = {"audio": audio_bytes, "filename": filename}
        return "i hungry"

    def fake_recover(broken_text: str) -> dict[str, str]:
        calls["gemini"] = {"broken": broken_text}
        return {"broken": broken_text, "recovered": "I am hungry."}

    def fake_synthesize(
        text: str,
        voice_id: str,
        tone_policy: str | None = None,
        use_expressive_model: bool = False,
    ) -> bytes:
        calls["elevenlabs"] = {
            "text": text,
            "voice_id": voice_id,
            "tone_policy": tone_policy,
            "use_expressive_model": use_expressive_model,
        }
        return b"mp3-bytes"

    monkeypatch.setattr(elevenlabs_service, "isolate_audio", fake_isolate)
    monkeypatch.setattr(whisper_service, "transcribe", fake_transcribe)
    monkeypatch.setattr(gemini_service, "recover_speech", fake_recover)
    monkeypatch.setattr(elevenlabs_service, "synthesize", fake_synthesize)
    return calls


def _create_voice(client, elevenlabs_voice_id: str = "el_voice_1") -> dict:
    resp = client.post(
        "/api/voices",
        json={
            "name": "Alice",
            "elevenlabs_voice_id": elevenlabs_voice_id,
            "description": None,
            "is_cloned": False,
        },
    )
    return resp.json()


def _post_audio(
    client,
    voice_id: int,
    audio: bytes = b"raw-audio",
    noise_reduction_enabled: bool = False,
    eeg_assisted_tone_enabled: bool = False,
    broken_text_override: str | None = None,
):
    data = {
        "voice_id": str(voice_id),
        "noise_reduction_enabled": str(noise_reduction_enabled).lower(),
        "eeg_assisted_tone_enabled": str(eeg_assisted_tone_enabled).lower(),
    }
    if broken_text_override is not None:
        data["broken_text_override"] = broken_text_override

    return client.post(
        "/api/sessions/process",
        files={"audio": ("speech.webm", io.BytesIO(audio), "audio/webm")},
        data=data,
    )


def test_process_returns_recovery(client, mock_services, audio_dir):
    voice = _create_voice(client)
    resp = _post_audio(client, voice["id"])
    assert resp.status_code == 200
    body = resp.json()
    assert body["broken_text"] == "i hungry"
    assert body["recovered_text"] == "I am hungry."
    assert body["session_id"] > 0
    assert body["audio_url"].startswith("/audio/")
    assert body["applied_tone_policy"] is None


def test_process_invokes_full_pipeline(client, mock_services, audio_dir):
    voice = _create_voice(client, elevenlabs_voice_id="el_voice_xyz")
    _post_audio(client, voice["id"], audio=b"raw-bytes-123")
    assert mock_services["whisper"]["audio"] == b"raw-bytes-123"
    assert mock_services["whisper"]["filename"] == "speech.webm"
    assert mock_services["gemini"]["broken"] == "i hungry"
    assert mock_services["elevenlabs"]["text"] == "I am hungry."
    assert mock_services["elevenlabs"]["voice_id"] == "el_voice_xyz"
    assert mock_services["elevenlabs"]["tone_policy"] is None
    assert mock_services["elevenlabs"]["use_expressive_model"] is False


def test_process_uses_broken_text_override_when_provided(
    client,
    mock_services,
    audio_dir,
):
    voice = _create_voice(client)
    _post_audio(
        client,
        voice["id"],
        audio=b"raw-bytes-123",
        broken_text_override="hi i need water",
    )
    assert "whisper" not in mock_services
    assert mock_services["gemini"]["broken"] == "hi i need water"


def test_process_with_noise_reduction_uses_isolated_audio(
    client,
    mock_services,
    audio_dir,
):
    voice = _create_voice(client)
    _post_audio(
        client,
        voice["id"],
        audio=b"noisy-audio",
        noise_reduction_enabled=True,
    )
    assert mock_services["isolator"]["audio"] == b"noisy-audio"
    assert mock_services["isolator"]["filename"] == "speech.webm"
    assert mock_services["whisper"]["audio"] == b"clean-audio"


def test_process_with_noise_reduction_falls_back_on_isolator_error(
    client,
    mock_services,
    audio_dir,
    monkeypatch: pytest.MonkeyPatch,
):
    voice = _create_voice(client)

    def broken_isolator(audio_bytes: bytes, filename: str = "audio.webm") -> bytes:
        raise RuntimeError("isolator down")

    monkeypatch.setattr(elevenlabs_service, "isolate_audio", broken_isolator)

    _post_audio(
        client,
        voice["id"],
        audio=b"original-audio",
        noise_reduction_enabled=True,
    )
    assert mock_services["whisper"]["audio"] == b"original-audio"


def test_process_writes_mp3_file(client, mock_services, audio_dir):
    voice = _create_voice(client)
    resp = _post_audio(client, voice["id"])
    filename = resp.json()["audio_url"].removeprefix("/audio/")
    saved = audio_dir / filename
    assert saved.exists()
    assert saved.read_bytes() == b"mp3-bytes"


def test_process_persists_session(client, mock_services, audio_dir, db_session):
    voice = _create_voice(client)
    resp = _post_audio(client, voice["id"])
    session_id = resp.json()["session_id"]
    row = db_session.exec(
        select(SessionModel).where(SessionModel.id == session_id)
    ).one()
    assert row.voice_id == voice["id"]
    assert row.broken_text == "i hungry"
    assert row.recovered_text == "I am hungry."
    assert row.audio_url is not None and row.audio_url.startswith("/audio/")


def test_process_unknown_voice_returns_404(client, mock_services, audio_dir):
    resp = _post_audio(client, voice_id=9999)
    assert resp.status_code == 404


def test_process_returns_502_when_gemini_is_unreachable(
    client,
    mock_services,
    audio_dir,
    monkeypatch: pytest.MonkeyPatch,
):
    voice = _create_voice(client)
    request = httpx.Request("POST", "https://generativelanguage.googleapis.com")

    def broken_recover(broken_text: str) -> dict[str, str]:
        raise httpx.ConnectError("dns lookup failed", request=request)

    monkeypatch.setattr(gemini_service, "recover_speech", broken_recover)

    resp = _post_audio(client, voice["id"])

    assert resp.status_code == 502
    assert "Gemini request failed" in resp.json()["detail"]


def test_process_requires_audio_and_voice_id(client, mock_services, audio_dir):
    resp = client.post("/api/sessions/process", data={})
    assert resp.status_code == 422


def test_process_uses_eeg_tone_when_enabled(
    client,
    mock_services,
    audio_dir,
    monkeypatch: pytest.MonkeyPatch,
):
    voice = _create_voice(client)
    monkeypatch.setattr(eeg_service, "get_current_tone_policy", lambda: "calm")

    resp = _post_audio(
        client,
        voice["id"],
        audio=b"brain-guided-audio",
        eeg_assisted_tone_enabled=True,
    )

    assert resp.status_code == 200
    assert resp.json()["applied_tone_policy"] == "calm"
    assert mock_services["elevenlabs"]["tone_policy"] == "calm"
    assert mock_services["elevenlabs"]["use_expressive_model"] is True


@pytest.fixture(autouse=True)
def reset_eeg_state():
    eeg_service.disconnect_device()
    yield
    eeg_service.disconnect_device()


def test_eeg_debug_snapshot_shape(client):
    debug_response = client.get("/api/eeg/debug")
    assert debug_response.status_code == 200
    body = debug_response.json()
    assert "telemetry" in body
    assert isinstance(body["recent_events"], list)
    assert body["telemetry"]["provider"] == "lsl"
