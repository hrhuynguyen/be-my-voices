from datetime import UTC, datetime

from sqlmodel import Field, SQLModel


class Session(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    voice_id: int = Field(foreign_key="voice.id")
    broken_text: str
    recovered_text: str
    audio_url: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
