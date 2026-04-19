from pathlib import Path
from collections.abc import Sequence

from sqlmodel import Session, col, select

from app.models.voice import Voice
from app.schemas.voices import VoiceCloneCreate, VoiceCreate, VoiceUpdate
from app.services import elevenlabs_service

MAX_CLONE_SAMPLES = 3
SUPPORTED_CLONE_EXTENSIONS = {".mp3", ".wav"}
SUPPORTED_CLONE_CONTENT_TYPES = {
    "audio/mpeg",
    "audio/mp3",
    "audio/wav",
    "audio/x-wav",
    "audio/wave",
}


class InvalidVoiceSamplesError(ValueError):
    pass


def _is_supported_clone_sample(filename: str, content_type: str | None) -> bool:
    suffix = Path(filename).suffix.lower()
    normalized_content_type = (content_type or "").split(";")[0].strip().lower()
    return (
        suffix in SUPPORTED_CLONE_EXTENSIONS
        or normalized_content_type in SUPPORTED_CLONE_CONTENT_TYPES
    )


def create_voice(db: Session, data: VoiceCreate) -> Voice:
    voice = Voice(
        name=data.name,
        elevenlabs_voice_id=data.elevenlabs_voice_id,
        description=data.description,
        is_cloned=data.is_cloned,
    )
    db.add(voice)
    db.commit()
    db.refresh(voice)
    return voice


def list_voices(db: Session) -> list[Voice]:
    return list(db.exec(select(Voice).order_by(col(Voice.created_at).desc())).all())


def get_voice(db: Session, voice_id: int) -> Voice | None:
    return db.get(Voice, voice_id)


def clone_voice(
    db: Session,
    data: VoiceCloneCreate,
    audio_files: Sequence[tuple[str, bytes, str | None]],
) -> Voice:
    if not audio_files:
        raise InvalidVoiceSamplesError("At least one audio sample is required.")
    if len(audio_files) > MAX_CLONE_SAMPLES:
        raise InvalidVoiceSamplesError(
            f"At most {MAX_CLONE_SAMPLES} audio samples are allowed."
        )

    for filename, audio, content_type in audio_files:
        if not audio:
            raise InvalidVoiceSamplesError(f"Audio sample '{filename}' is empty.")
        if not _is_supported_clone_sample(filename, content_type):
            raise InvalidVoiceSamplesError(
                f"Audio sample '{filename}' must be an MP3 or WAV file."
            )

    elevenlabs_voice_id = elevenlabs_service.clone_voice(
        data.name, audio_files, description=data.description
    )

    voice = Voice(
        name=data.name,
        elevenlabs_voice_id=elevenlabs_voice_id,
        description=data.description,
        is_cloned=True,
    )
    db.add(voice)
    db.commit()
    db.refresh(voice)
    return voice


def update_voice(db: Session, voice_id: int, data: VoiceUpdate) -> Voice | None:
    voice = db.get(Voice, voice_id)
    if voice is None:
        return None

    voice.name = data.name
    voice.description = data.description
    db.add(voice)
    db.commit()
    db.refresh(voice)
    return voice


def delete_voice(db: Session, voice_id: int) -> bool:
    voice = db.get(Voice, voice_id)
    if voice is None:
        return False
    db.delete(voice)
    db.commit()
    return True
