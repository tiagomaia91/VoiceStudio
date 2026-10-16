#!/usr/bin/env bash
# Maia Voice: instalação do ambiente de teste no GitHub Codespaces (CPU).
set -euo pipefail
cd "$(dirname "$0")/.."

echo "[maia] Instalando ffmpeg e libsndfile..."
sudo apt-get update -qq
sudo apt-get install -y -qq --no-install-recommends ffmpeg libsndfile1 >/dev/null

echo "[maia] Instalando bun e uv..."
if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.2" >/dev/null
fi
export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"
if ! command -v uv >/dev/null 2>&1; then
  pip install --quiet uv
fi

echo "[maia] Instalando dependências da interface..."
bun install --frozen-lockfile

echo "[maia] Gerando a interface web..."
bun run build:web

echo "[maia] Instalando o backend em modo CPU (alguns minutos)..."
bun run setup:api

mkdir -p "${OMNIVOICE_DATA_DIR:-/workspaces/maia-voice-data}"
echo "[maia] Instalação concluída."
