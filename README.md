# Be My Voices

Be My Voices is a speech recovery application.

The recorder now uses ElevenLabs Realtime STT for live broken dictation in the browser and sends that same transcript into the recovery pipeline when available.

## Stack

- Frontend: React + Vite + Tailwind
- Backend: FastAPI + SQLModel
- Database: PostgreSQL
- AI services: ElevenLabs Speech to Text, Gemini, ElevenLabs Text to Speech

Current model choices:

- Transcription: `scribe_v2`
- Recovery: `gemini-2.5-flash`
- Text-to-speech:
  - default sessions: `eleven_flash_v2_5`
  - EEG-assisted tone mode: `eleven_v3`

Current TTS behavior:
- Normal sessions use ElevenLabs `eleven_flash_v2_5` for lower latency
- EEG-assisted tone mode uses `eleven_v3`
- When EEG-assisted tone mode is active, synthesis applies the mapped EEG tone tag before generation

## Muse 2 EEG Mode

Muse 2 is now integrated as an optional experimental input for tone steering.

Current scope:
- Detect broad affective state only: `stress`, `valence`, `arousal`
- Map those signals into a small tone policy for TTS
- Do not treat Muse 2 as a direct full-emotion detector

Current implementation:
- Backend EEG service with connection state, telemetry, and debug log
- Frontend `Connected Devices` section with:
  - `Connect Muse 2`
  - `Check connection`
  - `Disconnect`
- Frontend live Muse dashboard with:
  - stream state
  - rolling `stress`, `valence`, and `arousal`
  - current tone policy
  - per-channel band power
  - last sample / last window timestamps
- Session-level `EEG-assisted tone mode` toggle
- TTS tone steering is only applied when live EEG telemetry is available

Current Python stack behavior:
- Required EEG extras for live Muse 2: `muselsl`, `pylsl`, `MNE-Python`, `NeuroKit2`, `mne-features`
- A pure-Python fallback feature pipeline is used when the full stack is unavailable

Current product mapping:
- EEG scores in
- tone policy out: `calm`, `neutral`, `stressed`, or `urgent`
- ElevenLabs `eleven_v3` uses that tone policy when `EEG-assisted tone mode` is enabled

## Requirements

- Python 3.11+
- Node.js 22+
- Docker
- `backend/.env` with:
- `DATABASE_URL`
- `GEMINI_API_KEY`
- `ELEVENLABS_API_KEY`

Optional for live Muse 2:
- local Python: `pip install ".[eeg]"` inside `backend`
- Docker backend: EEG extras are installed automatically during `docker compose up --build`
- a running Muse 2 LSL stream

## Run Locally

Start Postgres:

```bash
docker compose up -d db
```

Start backend:

```bash
cd backend
./run_backend_uvicorn.sh
```

Start frontend:

```bash
cd frontend
npm run dev
```

App URLs:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8000`
- Health check: `http://localhost:8000/api/health`

## Run With Docker

```bash
docker compose up --build
```

App URLs:

- Frontend: `http://localhost:4173`
- Backend: `http://localhost:8000`

Notes:
- The Docker backend image now installs the EEG extras automatically.
- Rebuild the backend image after this change with `docker compose up --build`.
- For local development, use `backend/run_backend_uvicorn.sh` so the reloader does not watch `.venv` or `audio_files`.

## Useful Commands

Backend tests:

```bash
backend/.venv/bin/pytest backend/tests -v
```

Frontend checks:

```bash
cd frontend && npm run type-check
cd frontend && npm run build
```

API key check:

```bash
cd backend && .venv/bin/python scripts/check_api_keys.py
```

# EEG Connection:

muselsl stream --address 015288CF-F75D-6FCB-4834-819A10A4328F  

## Manual Browser Check

1. Open the frontend.
2. Select an existing voice or clone a new one with uploaded `MP3`/`WAV` samples or recorded `WAV` samples.
3. If the voice is cloned, confirm you can edit its name/description or delete it from the selector.
4. If more than 4 voices exist, confirm the selector becomes scrollable.
5. Optionally enable `Noise reduction mode` for noisy rooms.
6. In `Connected Devices`, connect a live Muse 2 stream.
7. Confirm the dashboard shows `stress`, `valence`, `arousal`, and a tone policy.
8. Optionally enable `EEG-assisted tone mode`.
9. Allow microphone access.
10. Click `Start session` and speak one short phrase.
11. Confirm the recorder shows a live broken dictation while you speak.
12. Confirm the app shows broken text, recovered text, playable audio, and the applied tone policy.

## Docs

- API contracts: [docs/api-contracts.md](/Users/hrhuynguyen/Documents/Be%20My%20Voices/docs/api-contracts.md:1)
- Architecture: [docs/architecture.md](/Users/hrhuynguyen/Documents/Be%20My%20Voices/docs/architecture.md:1)
- End-to-end test: [docs/end-to-end-test.md](/Users/hrhuynguyen/Documents/Be%20My%20Voices/docs/end-to-end-test.md:1)
- Execution plan: [plan.md](/Users/hrhuynguyen/Documents/Be%20My%20Voices/plan.md:1)
