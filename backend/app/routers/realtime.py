import httpx
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.services import realtime_service

router = APIRouter(prefix="/api/realtime", tags=["realtime"])


class ScribeTokenResponse(BaseModel):
    token: str


@router.post("/scribe-token", response_model=ScribeTokenResponse)
async def create_scribe_token() -> ScribeTokenResponse:
    try:
        token = realtime_service.create_scribe_token()
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="ElevenLabs realtime token request failed.",
        ) from exc

    return ScribeTokenResponse(token=token)
