import httpx

from app.core.config import settings

TRANSCRIPTION_URL = "https://api.elevenlabs.io/v1/speech-to-text"
TRANSCRIPTION_MODEL = "scribe_v2"


def transcribe(audio_bytes: bytes, filename: str = "audio.webm") -> str:
    headers = {"xi-api-key": settings.elevenlabs_api_key}
    files = {"file": (filename, audio_bytes, "application/octet-stream")}
    data = {"model_id": TRANSCRIPTION_MODEL}

    with httpx.Client(timeout=60.0) as client:
        response = client.post(
            TRANSCRIPTION_URL,
            headers=headers,
            files=files,
            data=data,
        )
    response.raise_for_status()
    return str(response.json()["text"])
