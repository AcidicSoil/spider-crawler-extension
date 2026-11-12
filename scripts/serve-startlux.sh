#!/usr/bin/env bash
# Launch a local StartLux System One endpoint using already installed weights.
set -euo pipefail

model="${STARTLUX_GGUF_PATH:-}"
model_dir="${STARTLUX_MODEL_DIR:-$HOME/.local/share/startlux-decide/model-v1-4b}"
llama="${STARTLUX_LLAMA_BIN:-$(command -v llama-server || true)}"
engine="${STARTLUX_DECIDE_BIN:-$HOME/.local/share/startlux-decide/.venv/bin/startlux-decide}"
model_port="${STARTLUX_MODEL_PORT:-8811}"
api_port="${STARTLUX_API_PORT:-8812}"

if [[ -z "$model" || ! -f "$model" ]]; then
  echo "Set STARTLUX_GGUF_PATH to an installed GGUF model." >&2
  exit 1
fi
if [[ -z "$llama" || ! -x "$llama" || ! -x "$engine" || ! -d "$model_dir" ]]; then
  echo "Install llama-server and StartLux engine/configuration first." >&2
  exit 1
fi
for port in "$model_port" "$api_port"; do
  if [[ ! "$port" =~ ^[0-9]+$ ]] || (( port < 1024 || port > 65535 )); then
    echo "Invalid port: $port" >&2
    exit 1
  fi
  if ss -ltn "( sport = :$port )" | grep -q ":$port "; then
    echo "Port $port already in use; refusing to interrupt other services." >&2
    exit 1
  fi
done

runtime="${STARTLUX_RUNTIME_DIR:-$HOME/.local/share/startlux-decide}"
mkdir -p "$runtime"
"$llama" --model "$model" --host 127.0.0.1 --port "$model_port" \
  --no-webui --ctx-size 4096 --parallel 1 > "$runtime/llama.log" 2>&1 &
llama_pid=$!
cleanup() {
  kill "$llama_pid" 2>/dev/null || true
  wait "$llama_pid" 2>/dev/null || true
}
trap cleanup EXIT

ready=0
for _ in {1..60}; do
  if curl -fsS --max-time 2 "http://127.0.0.1:$model_port/health" >/dev/null 2>&1; then
    ready=1
    break
  fi
  if ! kill -0 "$llama_pid" 2>/dev/null; then break; fi
  sleep 1
done
if (( ! ready )); then
  echo "llama-server failed to start; see $runtime/llama.log" >&2
  exit 1
fi

echo "StartLux System One endpoint: http://127.0.0.1:$api_port/v1"
"$engine" serve --model "$model_dir" --backend llamacpp \
  --llamacpp-url "http://127.0.0.1:$model_port" \
  --host 127.0.0.1 --port "$api_port"
