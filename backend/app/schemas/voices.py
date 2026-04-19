from datetime import datetime

from pydantic import BaseModel


class VoiceCreate(BaseModel):
    name: str
    elevenlabs_voice_id: str
    description: str | None = None
    is_cloned: bool = False


class VoiceCloneCreate(BaseModel):
    name: str
    description: str | None = None


class VoiceUpdate(BaseModel):
    name: str
    description: str | None = None


class VoiceRead(BaseModel):
    id: int
    name: str
    elevenlabs_voice_id: str
    description: str | None
    is_cloned: bool
    created_at: datetime
