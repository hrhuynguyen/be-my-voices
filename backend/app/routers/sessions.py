from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlmodel import Session as DbSession

from app.dependencies import get_session
from app.schemas.sessions import ProcessResponse
from app.services import speech_service
from app.services.speech_service import ExternalServiceError, VoiceNotFoundError

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


@router.post("/process", response_model=ProcessResponse)
async def process_audio(
    audio: UploadFile = File(...),
    voice_id: int = Form(...),
    noise_reduction_enabled: bool = Form(False),
    eeg_assisted_tone_enabled: bool = Form(False),
    broken_text_override: str | None = Form(None),
    db: DbSession = Depends(get_session),
) -> ProcessResponse:
    audio_bytes = await audio.read()
    try:
        processed = speech_service.process_utterance(
            audio_bytes=audio_bytes,
            voice_id=voice_id,
            db=db,
            filename=audio.filename or "audio.webm",
            noise_reduction_enabled=noise_reduction_enabled,
            eeg_assisted_tone_enabled=eeg_assisted_tone_enabled,
            broken_text_override=broken_text_override,
        )
    except VoiceNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(e)
        ) from e
    except ExternalServiceError as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(e),
        ) from e

    session = processed.session
    assert session.id is not None
    return ProcessResponse(
        session_id=session.id,
        broken_text=session.broken_text,
        recovered_text=session.recovered_text,
        audio_url=session.audio_url or "",
        applied_tone_policy=processed.applied_tone_policy,
    )
