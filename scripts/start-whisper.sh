#!/bin/bash
# NICKII AI, speech to text.
# Section 8 of NICKIIAI.md.
#
# whisper.cpp in server mode: the model stays loaded, so per utterance latency
# is transcription only. It only ever receives PTT gated audio, never the
# continuous monitor feed.
#
# It binds to localhost, because for most of this project's life the server was
# on this same Mac. When the Pi is the server it has to be able to reach in, so
# NICKII_WHISPER_HOST=0.0.0.0 opens it to the installation's own network. That
# network has no uplink and nothing else on it, and the launcher sets this by
# itself when it finds the Pi.

set -euo pipefail

MODEL_DIR="${NICKII_MODEL_DIR:-$HOME/models}"
MODEL="$MODEL_DIR/ggml-large-v3-turbo.bin"
PORT="${NICKII_WHISPER_PORT:-8178}"
HOST="${NICKII_WHISPER_HOST:-127.0.0.1}"
THREADS="${NICKII_WHISPER_THREADS:-8}"

if ! command -v whisper-server >/dev/null 2>&1; then
  echo "whisper-server is not installed."
  echo "  brew install whisper-cpp"
  exit 1
fi

if [ ! -f "$MODEL" ]; then
  echo "Model not found at $MODEL"
  echo "Downloading ggml-large-v3-turbo (about 1.6 GB). This needs internet, so do it before Linz."
  mkdir -p "$MODEL_DIR"
  curl -L --fail --progress-bar \
    -o "$MODEL.part" \
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin?download=true"
  mv "$MODEL.part" "$MODEL"
fi

echo "whisper-server on $HOST:$PORT, model $(basename "$MODEL"), $THREADS threads"

exec whisper-server \
  -m "$MODEL" \
  --host "$HOST" \
  --port "$PORT" \
  -t "$THREADS"
