import httpx
import pytest

from app.services import elevenlabs_service
from app.services.elevenlabs_service import (
    DEFAULT_TONE_TAG,
    ELEVENLABS_BASE,
    TONE_TAGS,
    TTS_MODEL,
    clone_voice,
    synthesize,
)


@pytest.fixture
def mock_eleven(monkeypatch):
    captured: dict = {}

    real_client = httpx.Client

    def install(
        response_bytes: bytes | None = None,
        response_json: dict | None = None,
        status: int = 200,
    ) -> dict:
        def handler(request: httpx.Request) -> httpx.Response:
            captured["method"] = request.method
            captured["url"] = str(request.url)
            captured["headers"] = dict(request.headers)
            captured["content"] = request.content
            if response_json is not None:
                return httpx.Response(status, json=response_json)
            return httpx.Response(status, content=response_bytes or b"")

        def client_factory(*args, **kwargs):
            return real_client(transport=httpx.MockTransport(handler))

        monkeypatch.setattr(elevenlabs_service.httpx, "Client", client_factory)
        return captured

    return install


def test_synthesize_returns_audio_bytes(mock_eleven):
    mock_eleven(response_bytes=b"mp3-audio-bytes")
    result = synthesize("Hello world", "voice_abc")
    assert result == b"mp3-audio-bytes"


def test_synthesize_hits_voice_id_endpoint(mock_eleven):
    captured = mock_eleven(response_bytes=b"mp3")
    synthesize("hi", "voice_xyz")
    assert captured["method"] == "POST"
    assert captured["url"] == f"{ELEVENLABS_BASE}/text-to-speech/voice_xyz"


def test_synthesize_sends_api_key_header(mock_eleven):
    captured = mock_eleven(response_bytes=b"mp3")
    synthesize("hi", "v1")
    assert "xi-api-key" in captured["headers"]
    assert captured["headers"]["xi-api-key"]


def test_synthesize_sends_text_and_model(mock_eleven):
    captured = mock_eleven(response_bytes=b"mp3")
    synthesize("Hello there", "v1")
    body = captured["content"].decode()
    assert "Hello there" in body
    assert DEFAULT_TONE_TAG in body
    assert TTS_MODEL in body


def test_synthesize_uses_requested_tone_policy(mock_eleven):
    captured = mock_eleven(response_bytes=b"mp3")
    synthesize("Hello there", "v1", tone_policy="calm")
    body = captured["content"].decode()
    assert TONE_TAGS["calm"] in body


def test_synthesize_raises_on_error(mock_eleven):
    mock_eleven(response_json={"error": "bad"}, status=401)
    with pytest.raises(httpx.HTTPStatusError):
        synthesize("hi", "v1")


def test_clone_voice_returns_voice_id(mock_eleven):
    mock_eleven(response_json={"voice_id": "cloned_123"})
    result = clone_voice(
        "Alice",
        [
            ("sample1.wav", b"sample1", "audio/wav"),
            ("sample2.wav", b"sample2", "audio/wav"),
        ],
    )
    assert result == "cloned_123"


def test_clone_voice_hits_add_endpoint(mock_eleven):
    captured = mock_eleven(response_json={"voice_id": "v"})
    clone_voice("Alice", [("sample.wav", b"sample", "audio/wav")])
    assert captured["url"] == f"{ELEVENLABS_BASE}/voices/add"


def test_clone_voice_sends_name_and_files(mock_eleven):
    captured = mock_eleven(response_json={"voice_id": "v"})
    clone_voice(
        "Alice",
        [
            ("sample-a.wav", b"sample-audio-1", "audio/wav"),
            ("sample-b.wav", b"sample-audio-2", "audio/wav"),
        ],
    )
    body = captured["content"]
    assert b"Alice" in body
    assert b"sample-a.wav" in body
    assert b"sample-audio-1" in body
    assert b"sample-audio-2" in body


def test_clone_voice_includes_description_when_provided(mock_eleven):
    captured = mock_eleven(response_json={"voice_id": "v"})
    clone_voice(
        "Alice",
        [("sample.wav", b"sample", "audio/wav")],
        description="Patient voice",
    )
    assert b"Patient voice" in captured["content"]
