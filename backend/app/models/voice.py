from datetime import UTC, datetime

from sqlmodel import Field, SQLModel


class Voice(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str
    elevenlabs_voice_id: str
    description: str | None = None
    is_cloned: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
