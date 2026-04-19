import json

import httpx
import pytest

from app.services import gemini_service
from app.services.gemini_service import GEMINI_URL, recover_speech


def _gemini_response(broken: str, recovered: str) -> dict:
    return {
        "candidates": [
            {
                "content": {
                    "parts": [
                        {"text": json.dumps({"broken": broken, "recovered": recovered})}
                    ]
                }
            }
        ]
    }


@pytest.fixture
def mock_gemini(monkeypatch):
    captured: dict = {}

    real_client = httpx.Client

    def install(response_json: dict, status: int = 200) -> dict:
        def handler(request: httpx.Request) -> httpx.Response:
            captured["method"] = request.method
            captured["url"] = str(request.url)
            captured["headers"] = dict(request.headers)
            captured["body"] = json.loads(request.content)
            return httpx.Response(status, json=response_json)

        def client_factory(*args, **kwargs):
            return real_client(transport=httpx.MockTransport(handler))

        monkeypatch.setattr(gemini_service.httpx, "Client", client_factory)
        return captured

    return install


def test_recover_speech_parses_nested_json(mock_gemini):
    mock_gemini(_gemini_response("i hungry", "I am hungry."))
    result = recover_speech("i hungry")
    assert result == {"broken": "i hungry", "recovered": "I am hungry."}


def test_recover_speech_posts_to_gemini(mock_gemini):
    captured = mock_gemini(_gemini_response("x", "y"))
    recover_speech("x")
    assert captured["method"] == "POST"
    assert captured["url"] == GEMINI_URL


def test_recover_speech_sends_api_key_header(mock_gemini):
    captured = mock_gemini(_gemini_response("x", "y"))
    recover_speech("x")
    assert "x-goog-api-key" in captured["headers"]
    assert captured["headers"]["x-goog-api-key"]


def test_recover_speech_prompt_includes_broken_text(mock_gemini):
    captured = mock_gemini(_gemini_response("x", "y"))
    recover_speech("water please")
    prompt_text = captured["body"]["contents"][0]["parts"][0]["text"]
    assert "water please" in prompt_text
    assert "speech recovery" in prompt_text.lower()


def test_recover_speech_requests_json_mime(mock_gemini):
    captured = mock_gemini(_gemini_response("x", "y"))
    recover_speech("x")
    assert captured["body"]["generationConfig"]["responseMimeType"] == "application/json"


def test_recover_speech_raises_on_error(mock_gemini):
    mock_gemini({"error": "bad"}, status=500)
    with pytest.raises(httpx.HTTPStatusError):
        recover_speech("x")
