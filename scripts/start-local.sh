#!/usr/bin/env bash
# Avvia l'intero stack locale con un solo comando:
#   1. avvia Docker Desktop se non è in esecuzione e attende il daemon;
#   2. avvia i container Supabase (Postgres + Auth + Realtime);
#   3. genera .env.local con le chiavi locali;
#   4. compila e avvia la Web App Next.js in Docker;
#   5. apre il browser su http://localhost:3000 quando l'app risponde.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "=========================================================="
echo "              FANTASTA — AVVIO LOCALE"
echo "=========================================================="

# --- 1. Docker -------------------------------------------------------------
if docker info >/dev/null 2>&1; then
  echo "✓ Docker già in esecuzione."
else
  echo "» Docker non è in esecuzione..."
  if [[ "$(uname -s)" == "Darwin" ]]; then
    echo "  Apro Docker Desktop (attendi qualche secondo per il daemon)..."
    open -a Docker >/dev/null 2>&1 || true
  else
    echo "  ✗ Avvia Docker manualmente e rilancia il comando." >&2
    exit 1
  fi
  echo -n "  Attendo il daemon Docker"
  for _ in $(seq 1 60); do
    if docker info >/dev/null 2>&1; then
      echo ""
      echo "✓ Daemon Docker pronto."
      break
    fi
    echo -n "."
    sleep 2
  done
  if ! docker info >/dev/null 2>&1; then
    echo ""
    echo "  ✗ Docker non si è avviato entro 2 minuti." >&2
    echo "    Controlla Docker Desktop (icona nella barra in alto) e rilancia:" >&2
    echo "      make up" >&2
    exit 1
  fi
fi

# --- 2. Supabase -----------------------------------------------------------
echo "» Avvio dei container Supabase (la prima volta scarica le immagini)..."
npx supabase start

# --- 3. Variabili d'ambiente -----------------------------------------------
echo "» Sincronizzazione variabili .env.local..."
./scripts/setup-local-env.sh

# --- 4. Web App ------------------------------------------------------------
echo "» Compilazione e avvio della Web App Next.js..."
docker compose up -d --build

echo ""
echo "=========================================================="
echo "✓ Stack avviato con successo!"
echo "  • Web App:         http://localhost:3000"
echo "  • Supabase Studio: http://localhost:54323"
echo "  • Supabase API:    http://localhost:54321"
echo "  • Email Inbucket:  http://localhost:54324"
echo "=========================================================="

# --- 5. Apri il browser quando l'app risponde ------------------------------
if [[ "$(uname -s)" == "Darwin" ]]; then
  echo -n "» Attendo che la Web App risponda"
  for _ in $(seq 1 30); do
    if curl -sf -o /dev/null http://localhost:3000/; then
      echo ""
      echo "✓ Web App pronta, apro il browser..."
      open http://localhost:3000 >/dev/null 2>&1 || true
      break
    fi
    echo -n "."
    sleep 2
  done
fi
echo ""
echo "Per fermare tutto:  make down"
