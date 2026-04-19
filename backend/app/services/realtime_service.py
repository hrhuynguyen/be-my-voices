import httpx

from app.core.config import settings

SINGLE_USE_TOKEN_URL = "https://api.elevenlabs.io/v1/single-use-token/realtime_scribe"


def create_scribe_token() -> str:
    headers = {"xi-api-key": settings.elevenlabs_api_key}

    with httpx.Client(timeout=30.0) as client:
        response = client.post(SINGLE_USE_TOKEN_URL, headers=headers)
    response.raise_for_status()
    return str(response.json()["token"])
