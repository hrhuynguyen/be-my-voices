import logging
import uuid
from dataclasses import dataclass
from pathlib import Path

import httpx
from sqlmodel import Session as DbSession

from app.models.session import Session as SessionModel
from app.models.voice import Voice
from app.services import eeg_service, elevenlabs_service, gemini_service, whisper_service

AUDIO_DIR = Path("audio_files")
logger = logging.getLogger(__name__)


class VoiceNotFoundError(ValueError):
    pass


class ExternalServiceError(RuntimeError):
    def __init__(self, service: str, detail: str):
        self.service = service
        self.detail = detail
        super().__init__(f"{service} request failed: {detail}")


@dataclass
class ProcessedUtterance:
    session: SessionModel
    applied_tone_policy: str | None = None


def _raise_external_service_error(service: str, exc: httpx.HTTPError) -> None:
    if isinstance(exc, httpx.HTTPStatusError):
        detail = f"HTTP {exc.response.status_code}"
        try:
            response_text = exc.response.text.strip()
        except Exception:
            response_text = ""
        if response_text:
            detail = f"{detail}: {response_text[:200]}"
    else:
        detail = str(exc)

    raise ExternalServiceError(service, detail) from exc


def process_utterance(
    audio_bytes: bytes,
    voice_id: int,
    db: DbSession,
    filename: str = "audio.webm",
    noise_reduction_enabled: bool = False,
    eeg_assisted_tone_enabled: bool = False,
    broken_text_override: str | None = None,
) -> ProcessedUtterance:
    voice = db.get(Voice, voice_id)
    if voice is None:
        raise VoiceNotFoundError(f"Voice {voice_id} not found")

    audio_for_transcription = audio_bytes
    if noise_reduction_enabled:
        try:
            audio_for_transcription = elevenlabs_service.isolate_audio(
                audio_bytes,
                filename=filename,
            )
        except Exception as exc:
            logger.warning(
                "Voice isolation failed. Falling back to original audio.",
                exc_info=True,
            )

    broken_text = (broken_text_override or "").strip()
    if not broken_text:
        try:
            broken_text = whisper_service.transcribe(
                audio_for_transcription,
                filename=filename,
            )
        except httpx.HTTPError as exc:
            _raise_external_service_error("ElevenLabs STT", exc)

    try:
        recovery = gemini_service.recover_speech(broken_text)
    except httpx.HTTPError as exc:
        _raise_external_service_error("Gemini", exc)
    recovered_text = recovery["recovered"]

    try:
        tone_policy = (
            eeg_service.get_current_tone_policy()
            if eeg_assisted_tone_enabled
            else None
        )
        mp3_bytes = elevenlabs_service.synthesize(
            recovered_text,
            voice.elevenlabs_voice_id,
            tone_policy=tone_policy,
            use_expressive_model=eeg_assisted_tone_enabled,
        )
    except httpx.HTTPError as exc:
        _raise_external_service_error("ElevenLabs TTS", exc)

    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    file_id = uuid.uuid4().hex
    (AUDIO_DIR / f"{file_id}.mp3").write_bytes(mp3_bytes)

    session = SessionModel(
        voice_id=voice_id,
        broken_text=broken_text,
        recovered_text=recovered_text,
        audio_url=f"/audio/{file_id}.mp3",
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return ProcessedUtterance(
        session=session,
        applied_tone_policy=tone_policy,
    )
