import httpx
import pytest

from app.services import whisper_service
from app.services.whisper_service import (
    TRANSCRIPTION_MODEL,
    TRANSCRIPTION_URL,
    transcribe,
)


@pytest.fixture
def mock_whisper(monkeypatch):
    captured: dict = {}

    def make_handler(response_json: dict | None = None, status: int = 200):
        def handler(request: httpx.Request) -> httpx.Response:
            captured["method"] = request.method
            captured["url"] = str(request.url)
            captured["headers"] = dict(request.headers)
            captured["content"] = request.content
            return httpx.Response(status, json=response_json or {"text": "hello world"})
        return handler

    real_client = httpx.Client

    def install(response_json: dict | None = None, status: int = 200) -> dict:
        handler = make_handler(response_json, status)

        def client_factory(*args, **kwargs):
            return real_client(transport=httpx.MockTransport(handler))

        monkeypatch.setattr(whisper_service.httpx, "Client", client_factory)
        return captured

    return install


def test_transcribe_returns_text(mock_whisper):
    mock_whisper({"text": "the quick brown fox"})
    assert transcribe(b"fake audio bytes") == "the quick brown fox"


def test_transcribe_posts_to_elevenlabs(mock_whisper):
    captured = mock_whisper()
    transcribe(b"audio")
    assert captured["method"] == "POST"
    assert captured["url"] == TRANSCRIPTION_URL


def test_transcribe_sends_xi_api_key(mock_whisper):
    captured = mock_whisper()
    transcribe(b"audio")
    assert "xi-api-key" in captured["headers"]


def test_transcribe_sends_model_and_file(mock_whisper):
    captured = mock_whisper()
    transcribe(b"audio-bytes-here", filename="speech.webm")
    body = captured["content"]
    assert TRANSCRIPTION_MODEL.encode() in body
    assert b"audio-bytes-here" in body
    assert b"speech.webm" in body


def test_transcribe_raises_on_error(mock_whisper):
    mock_whisper({"error": "bad"}, status=500)
    with pytest.raises(httpx.HTTPStatusError):
        transcribe(b"audio")
