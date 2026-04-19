import json

import httpx

from app.core.config import settings

GEMINI_MODEL = "gemini-2.5-flash"
GEMINI_URL = (
    f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
)

SYSTEM_PROMPT = (
    "You are a speech recovery assistant. The patient has a speech impairment. "
    "Given their broken speech transcription, reconstruct what they intended to "
    "say as a short, natural spoken utterance of about 2 sentences (roughly 12 to 28 "
    "words). The first sentence must cover the core intent clearly. The second "
    "sentence should elaborate naturally with the implied need, urgency, or "
    "polite follow-up (for example: asking for help, explaining who or what the "
    "request is about, or expressing thanks). Stay faithful to the patient's "
    "intent and tone — do not invent facts, names, places, or conditions the "
    "patient did not reference. Do not add medical details. Write in first "
    "person, conversational, and easy to speak aloud.\n\n"
    "Example:\n"
    "Broken: uh uh I I nid nid help\n"
    'Output: {"broken": "uh uh I I nid nid help", "recovered": "I need some help. Can somebody help me please?"}\n\n'
    'Return ONLY JSON in this exact shape: {"broken": "<original>", "recovered": "<reconstructed>"}'
)


def recover_speech(broken_text: str) -> dict[str, str]:
    headers = {
        "Content-Type": "application/json",
        "x-goog-api-key": settings.gemini_api_key,
    }
    body = {
        "contents": [
            {"role": "user", "parts": [{"text": f"{SYSTEM_PROMPT}\n\nBroken: {broken_text}"}]}
        ],
        "generationConfig": {"responseMimeType": "application/json"},
    }

    with httpx.Client(timeout=60.0) as client:
        response = client.post(GEMINI_URL, headers=headers, json=body)
    response.raise_for_status()

    payload = response.json()
    text = payload["candidates"][0]["content"]["parts"][0]["text"]
    parsed = json.loads(text)
    return {"broken": str(parsed["broken"]), "recovered": str(parsed["recovered"])}
