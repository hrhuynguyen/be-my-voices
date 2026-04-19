from collections.abc import Sequence

import httpx

from app.core.config import settings

ELEVENLABS_BASE = "https://api.elevenlabs.io/v1"
TTS_MODEL = "eleven_v3"
DEFAULT_TONE_TAG = "[stressed]"
TONE_TAGS: dict[str, str] = {
    "calm": "[calm]",
    "neutral": "[neutral]",
    "stressed": "[stressed]",
    "urgent": "[urgent]",
}


def _with_default_tone(text: str, tone_policy: str | None = None) -> str:
    stripped = text.strip()
    if not stripped:
        return stripped
    if stripped.startswith("["):
        return stripped
    tone_tag = TONE_TAGS.get(tone_policy or "", DEFAULT_TONE_TAG)
    return f"{tone_tag} {stripped}"


def synthesize(text: str, voice_id: str, tone_policy: str | None = None) -> bytes:
    url = f"{ELEVENLABS_BASE}/text-to-speech/{voice_id}"
    headers = {
        "xi-api-key": settings.elevenlabs_api_key,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
    }
    body = {
        "text": _with_default_tone(text, tone_policy=tone_policy),
        "model_id": TTS_MODEL,
    }

    with httpx.Client(timeout=120.0) as client:
        response = client.post(url, headers=headers, json=body)
    response.raise_for_status()
    return response.content


def isolate_audio(audio_bytes: bytes, filename: str = "audio.webm") -> bytes:
    url = f"{ELEVENLABS_BASE}/audio-isolation"
    headers = {"xi-api-key": settings.elevenlabs_api_key}
    files = {"audio": (filename, audio_bytes, "application/octet-stream")}
    data = {"file_format": "other"}

    with httpx.Client(timeout=120.0) as client:
        response = client.post(url, headers=headers, files=files, data=data)
    response.raise_for_status()
    return response.content


def clone_voice(
    name: str,
    audio_files: Sequence[tuple[str, bytes, str | None]],
    description: str | None = None,
) -> str:
    url = f"{ELEVENLABS_BASE}/voices/add"
    headers = {"xi-api-key": settings.elevenlabs_api_key}
    data: dict[str, str] = {"name": name}
    if description:
        data["description"] = description
    files = [
        ("files", (filename, audio, content_type or "application/octet-stream"))
        for filename, audio, content_type in audio_files
    ]

    with httpx.Client(timeout=120.0) as client:
        response = client.post(url, headers=headers, data=data, files=files)
    response.raise_for_status()
    return str(response.json()["voice_id"])
