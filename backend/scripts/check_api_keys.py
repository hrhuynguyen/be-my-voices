"""Temporary script: validate API keys + measure service latency.

Run from backend/ with the venv active:
    .venv/bin/python scripts/check_api_keys.py
"""

from __future__ import annotations

import struct
import sys
import time
from dataclasses import dataclass

import httpx

from app.core.config import settings
from app.services import elevenlabs_service, gemini_service, whisper_service


@dataclass
class Result:
    name: str
    ok: bool
    latency_ms: float | None
    detail: str


def _silent_wav(duration_s: float = 0.5, rate: int = 16000) -> bytes:
    """Generate a minimal silent WAV (PCM16 mono) for STT testing."""
    n_samples = int(duration_s * rate)
    data = b"\x00\x00" * n_samples
    byte_rate = rate * 2
    header = b"RIFF"
    header += struct.pack("<I", 36 + len(data))
    header += b"WAVEfmt "
    header += struct.pack("<IHHIIHH", 16, 1, 1, rate, byte_rate, 2, 16)
    header += b"data"
    header += struct.pack("<I", len(data))
    return header + data


def check_elevenlabs_stt() -> Result:
    """Validate ElevenLabs STT + measure latency on a 0.5s silent clip."""
    audio = _silent_wav()
    start = time.perf_counter()
    try:
        text = whisper_service.transcribe(audio, filename="silence.wav")
    except httpx.HTTPStatusError as e:
        return Result(
            "ElevenLabs STT",
            False,
            None,
            f"HTTP {e.response.status_code}: {e.response.text[:200]}",
        )
    except Exception as e:
        return Result("ElevenLabs STT", False, None, f"{type(e).__name__}: {e}")
    elapsed = (time.perf_counter() - start) * 1000
    return Result("ElevenLabs STT", True, elapsed, f"transcript={text!r}")


def check_gemini() -> Result:
    start = time.perf_counter()
    try:
        out = gemini_service.recover_speech("i hungry")
    except httpx.HTTPStatusError as e:
        return Result("Google Gemini", False, None, f"HTTP {e.response.status_code}: {e.response.text[:200]}")
    except Exception as e:
        return Result("Google Gemini", False, None, f"{type(e).__name__}: {e}")
    elapsed = (time.perf_counter() - start) * 1000
    return Result("Google Gemini", True, elapsed, f"recovered={out['recovered']!r}")


def _get_first_elevenlabs_voice() -> str | None:
    headers = {"xi-api-key": settings.elevenlabs_api_key}
    with httpx.Client(timeout=30.0) as c:
        r = c.get(f"{elevenlabs_service.ELEVENLABS_BASE}/voices", headers=headers)
    r.raise_for_status()
    voices = r.json().get("voices", [])
    return voices[0]["voice_id"] if voices else None


def check_elevenlabs_key() -> Result:
    """Check key validity + quota via /v1/user (no credits consumed)."""
    headers = {"xi-api-key": settings.elevenlabs_api_key}
    start = time.perf_counter()
    try:
        with httpx.Client(timeout=30.0) as c:
            r = c.get(f"{elevenlabs_service.ELEVENLABS_BASE}/user", headers=headers)
        r.raise_for_status()
    except httpx.HTTPStatusError as e:
        return Result("ElevenLabs /user", False, None, f"HTTP {e.response.status_code}: {e.response.text[:200]}")
    except Exception as e:
        return Result("ElevenLabs /user", False, None, f"{type(e).__name__}: {e}")
    elapsed = (time.perf_counter() - start) * 1000
    sub = r.json().get("subscription", {})
    tier = sub.get("tier", "?")
    used = sub.get("character_count", "?")
    limit = sub.get("character_limit", "?")
    return Result("ElevenLabs /user", True, elapsed, f"tier={tier} chars={used}/{limit}")


def check_elevenlabs_tts() -> Result:
    try:
        voice_id = _get_first_elevenlabs_voice()
    except Exception as e:
        return Result("ElevenLabs TTS", False, None, f"voice list failed: {e}")
    if voice_id is None:
        return Result("ElevenLabs TTS", False, None, "no voices on account")

    start = time.perf_counter()
    try:
        mp3 = elevenlabs_service.synthesize("Hello, this is a latency test.", voice_id)
    except httpx.HTTPStatusError as e:
        return Result("ElevenLabs TTS", False, None, f"HTTP {e.response.status_code}: {e.response.text[:200]}")
    except Exception as e:
        return Result("ElevenLabs TTS", False, None, f"{type(e).__name__}: {e}")
    elapsed = (time.perf_counter() - start) * 1000
    return Result("ElevenLabs TTS", True, elapsed, f"voice={voice_id} bytes={len(mp3)}")


def main() -> int:
    print("Checking API keys + latency...\n")
    results = [
        check_elevenlabs_stt(),
        check_gemini(),
        check_elevenlabs_key(),
        check_elevenlabs_tts(),
    ]

    col_w = max(len(r.name) for r in results)
    for r in results:
        status = "OK  " if r.ok else "FAIL"
        lat = f"{r.latency_ms:>7.0f} ms" if r.latency_ms is not None else "     ---"
        print(f"[{status}] {r.name:<{col_w}}  {lat}   {r.detail}")

    print()
    all_ok = all(r.ok for r in results)
    print("All keys valid." if all_ok else "One or more checks failed — see above.")
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
