from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.core.config import settings
from app.routers import eeg, realtime, sessions, voices
from app.services.speech_service import AUDIO_DIR

app = FastAPI(title="Be My Voices", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

AUDIO_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/audio", StaticFiles(directory=AUDIO_DIR), name="audio")

app.include_router(voices.router)
app.include_router(sessions.router)
app.include_router(realtime.router)
app.include_router(eeg.router)


@app.get("/api/health")
async def health_check():
    return {"status": "ok"}
