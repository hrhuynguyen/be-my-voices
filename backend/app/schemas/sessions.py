from pydantic import BaseModel


class ProcessResponse(BaseModel):
    session_id: int
    broken_text: str
    recovered_text: str
    audio_url: str
    applied_tone_policy: str | None = None
