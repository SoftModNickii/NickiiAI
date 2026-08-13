#!/bin/bash
# NICKII AI, speech to text.
# Section 8 of NICKIIAI.md.
#
# whisper.cpp in server mode: the model stays loaded, so per utterance latency
# is transcription only. Bound to localhost, never exposed on the Wi-Fi network.
# It only ever receives PTT gated audio, never the continuous monitor feed.

set -euo pipefail

MODEL_DIR="${NICKII_MODEL_DIR:-$HOME/models}"
MODEL="$MODEL_DIR/ggml-large-v3-turbo.bin"
PORT="${NICKII_WHISPER_PORT:-8178}"
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

echo "whisper-server on 127.0.0.1:$PORT, model $(basename "$MODEL"), $THREADS threads"

exec whisper-server \
  -m "$MODEL" \
  --host 127.0.0.1 \
  --port "$PORT" \
  -t "$THREADS"
