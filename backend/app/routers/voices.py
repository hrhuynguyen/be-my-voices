from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlmodel import Session

from app.dependencies import get_session
from app.models.voice import Voice
from app.schemas.voices import VoiceCloneCreate, VoiceCreate, VoiceRead, VoiceUpdate
from app.services import voice_service

router = APIRouter(prefix="/api/voices", tags=["voices"])


@router.get("", response_model=list[VoiceRead])
async def list_voices(db: Session = Depends(get_session)) -> list[Voice]:
    return voice_service.list_voices(db)


@router.post("", response_model=VoiceRead, status_code=status.HTTP_201_CREATED)
async def create_voice(
    payload: VoiceCreate, db: Session = Depends(get_session)
) -> Voice:
    return voice_service.create_voice(db, payload)


@router.post("/clone", response_model=VoiceRead, status_code=status.HTTP_201_CREATED)
async def clone_voice(
    name: str = Form(...),
    description: str | None = Form(None),
    samples: list[UploadFile] = File(...),
    db: Session = Depends(get_session),
) -> Voice:
    payload = VoiceCloneCreate(name=name, description=description)
    audio_files = [
        (sample.filename or "sample", await sample.read(), sample.content_type)
        for sample in samples
    ]
    try:
        return voice_service.clone_voice(db, payload, audio_files)
    except voice_service.InvalidVoiceSamplesError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e


@router.get("/{voice_id}", response_model=VoiceRead)
async def get_voice(voice_id: int, db: Session = Depends(get_session)) -> Voice:
    voice = voice_service.get_voice(db, voice_id)
    if voice is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Voice not found")
    return voice


@router.patch("/{voice_id}", response_model=VoiceRead)
async def update_voice(
    voice_id: int, payload: VoiceUpdate, db: Session = Depends(get_session)
) -> Voice:
    voice = voice_service.update_voice(db, voice_id, payload)
    if voice is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Voice not found"
        )
    return voice


@router.delete("/{voice_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_voice(voice_id: int, db: Session = Depends(get_session)) -> None:
    deleted = voice_service.delete_voice(db, voice_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Voice not found")
