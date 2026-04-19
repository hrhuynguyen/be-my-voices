import httpx
import pytest

from app.services import realtime_service


@pytest.fixture
def mock_realtime_token(monkeypatch: pytest.MonkeyPatch):
    captured: dict = {}
    real_client = httpx.Client

    def install(token: str = "sutkn_test", status: int = 200) -> dict:
        def handler(request: httpx.Request) -> httpx.Response:
            captured["method"] = request.method
            captured["url"] = str(request.url)
            captured["headers"] = dict(request.headers)
            return httpx.Response(status, json={"token": token})

        def client_factory(*args, **kwargs):
            return real_client(transport=httpx.MockTransport(handler))

        monkeypatch.setattr(realtime_service.httpx, "Client", client_factory)
        return captured

    return install


def test_create_scribe_token_posts_to_elevenlabs(mock_realtime_token):
    captured = mock_realtime_token()
    token = realtime_service.create_scribe_token()

    assert token == "sutkn_test"
    assert captured["method"] == "POST"
    assert captured["url"] == realtime_service.SINGLE_USE_TOKEN_URL
    assert "xi-api-key" in captured["headers"]


def test_create_scribe_token_raises_on_error(mock_realtime_token):
    mock_realtime_token(status=500)

    with pytest.raises(httpx.HTTPStatusError):
        realtime_service.create_scribe_token()
