#!/usr/bin/env bash
# Maia Voice: inicia o servidor de teste na porta 3900 com login por chave.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"

DATA_DIR="${OMNIVOICE_DATA_DIR:-/workspaces/maia-voice-data}"
mkdir -p "$DATA_DIR"
KEY_FILE="$DATA_DIR/.maia-api-key"
if [ ! -s "$KEY_FILE" ]; then
  python3 -c 'import secrets; print(secrets.token_urlsafe(32))' > "$KEY_FILE"
  chmod 600 "$KEY_FILE"
fi

if curl -sf http://localhost:3900/health >/dev/null 2>&1; then
  echo "[maia] Servidor já está rodando na porta 3900."
else
  echo "[maia] Iniciando o Maia Voice..."
  OMNIVOICE_SERVER_MODE=1 \
  OMNIVOICE_API_KEY="$(cat "$KEY_FILE")" \
  OMNIVOICE_BIND_HOST=0.0.0.0 \
  PYTHONPATH="$PWD/backend" \
    nohup uv run --no-sync python backend/docker_entrypoint.py > "$DATA_DIR/maia-voice.log" 2>&1 &
  for _ in $(seq 1 90); do
    curl -sf http://localhost:3900/health >/dev/null 2>&1 && break
    sleep 2
  done
fi

echo ""
echo "=================================================================="
echo " Maia Voice rodando na porta 3900 (aba PORTS > Maia Voice)"
echo " Chave de acesso para o login:"
echo ""
echo "   $(cat "$KEY_FILE")"
echo ""
echo " Logs: $DATA_DIR/maia-voice.log"
echo "=================================================================="
