from app.services import voice_service


def _payload(**overrides):
    data = {
        "name": "Alice",
        "elevenlabs_voice_id": "el_voice_123",
        "description": "Test voice",
        "is_cloned": False,
    }
    data.update(overrides)
    return data


def test_list_empty(client):
    resp = client.get("/api/voices")
    assert resp.status_code == 200
    assert resp.json() == []


def test_create_voice(client):
    resp = client.post("/api/voices", json=_payload())
    assert resp.status_code == 201
    body = resp.json()
    assert body["id"] is not None
    assert body["name"] == "Alice"
    assert body["elevenlabs_voice_id"] == "el_voice_123"
    assert body["is_cloned"] is False
    assert "created_at" in body


def test_list_after_create(client):
    client.post("/api/voices", json=_payload(name="A"))
    client.post("/api/voices", json=_payload(name="B", elevenlabs_voice_id="el_b"))
    resp = client.get("/api/voices")
    assert resp.status_code == 200
    names = {v["name"] for v in resp.json()}
    assert names == {"A", "B"}


def test_get_voice(client):
    created = client.post("/api/voices", json=_payload()).json()
    resp = client.get(f"/api/voices/{created['id']}")
    assert resp.status_code == 200
    assert resp.json()["id"] == created["id"]


def test_get_voice_not_found(client):
    resp = client.get("/api/voices/9999")
    assert resp.status_code == 404


def test_update_voice(client):
    created = client.post(
        "/api/voices",
        json=_payload(name="Original", description="Before", is_cloned=True),
    ).json()
    resp = client.patch(
        f"/api/voices/{created['id']}",
        json={"name": "Updated", "description": "After"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "Updated"
    assert body["description"] == "After"
    assert body["elevenlabs_voice_id"] == "el_voice_123"


def test_update_voice_not_found(client):
    resp = client.patch(
        "/api/voices/9999",
        json={"name": "Updated", "description": "After"},
    )
    assert resp.status_code == 404


def test_delete_voice(client):
    created = client.post("/api/voices", json=_payload()).json()
    resp = client.delete(f"/api/voices/{created['id']}")
    assert resp.status_code == 204
    assert client.get(f"/api/voices/{created['id']}").status_code == 404


def test_delete_voice_not_found(client):
    resp = client.delete("/api/voices/9999")
    assert resp.status_code == 404


def test_clone_voice(client, monkeypatch):
    captured: dict = {}

    def fake_clone(
        name: str,
        audio_files: list[tuple[str, bytes, str | None]],
        description: str | None = None,
    ) -> str:
        captured["name"] = name
        captured["description"] = description
        captured["audio_files"] = audio_files
        return "cloned_voice_123"

    monkeypatch.setattr(voice_service.elevenlabs_service, "clone_voice", fake_clone)

    resp = client.post(
        "/api/voices/clone",
        data={"name": "Alice Clone", "description": "Patient voice"},
        files=[
            ("samples", ("sample1.wav", b"audio-1", "audio/wav")),
            ("samples", ("sample2.wav", b"audio-2", "audio/wav")),
        ],
    )

    assert resp.status_code == 201
    body = resp.json()
    assert body["name"] == "Alice Clone"
    assert body["description"] == "Patient voice"
    assert body["elevenlabs_voice_id"] == "cloned_voice_123"
    assert body["is_cloned"] is True
    assert captured["name"] == "Alice Clone"
    assert captured["description"] == "Patient voice"
    assert captured["audio_files"] == [
        ("sample1.wav", b"audio-1", "audio/wav"),
        ("sample2.wav", b"audio-2", "audio/wav"),
    ]


def test_clone_voice_rejects_too_many_samples(client):
    resp = client.post(
        "/api/voices/clone",
        data={"name": "Alice Clone"},
        files=[
            ("samples", ("sample1.wav", b"audio-1", "audio/wav")),
            ("samples", ("sample2.wav", b"audio-2", "audio/wav")),
            ("samples", ("sample3.wav", b"audio-3", "audio/wav")),
            ("samples", ("sample4.wav", b"audio-4", "audio/wav")),
        ],
    )

    assert resp.status_code == 400
    assert "At most 3 audio samples" in resp.json()["detail"]


def test_clone_voice_rejects_non_audio_file(client):
    resp = client.post(
        "/api/voices/clone",
        data={"name": "Alice Clone"},
        files=[("samples", ("notes.txt", b"not-audio", "text/plain"))],
    )

    assert resp.status_code == 400
    assert "MP3 or WAV" in resp.json()["detail"]


def test_clone_voice_rejects_unsupported_audio_format(client):
    resp = client.post(
        "/api/voices/clone",
        data={"name": "Alice Clone"},
        files=[("samples", ("sample.webm", b"audio", "audio/webm"))],
    )

    assert resp.status_code == 400
    assert "MP3 or WAV" in resp.json()["detail"]
