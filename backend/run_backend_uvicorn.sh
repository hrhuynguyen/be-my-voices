#!/bin/zsh
set -euo pipefail

cd "$(dirname "$0")"

exec .venv/bin/python -m uvicorn app.main:app \
  --reload \
  --reload-exclude '.venv/*' \
  --reload-exclude 'audio_files/*' \
  --reload-exclude 'build/*' \
  --reload-exclude '*.egg-info/*'
