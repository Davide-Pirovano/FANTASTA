#!/usr/bin/env bash
set -euo pipefail

echo "=== Configurazione Ambiente Locale Supabase ==="

# Verifica se Supabase è avviato
if ! npx supabase status >/dev/null 2>&1; then
  echo "Supabase non è in esecuzione. Avvio in corso..."
  npx supabase start
fi

STATUS_JSON=$(npx supabase status -o json)

API_URL=$(echo "$STATUS_JSON" | grep -o '"API_URL": *"[^"]*"' | head -1 | cut -d'"' -f4 || true)
ANON_KEY=$(echo "$STATUS_JSON" | grep -o '"ANON_KEY": *"[^"]*"' | head -1 | cut -d'"' -f4 || true)
SERVICE_ROLE_KEY=$(echo "$STATUS_JSON" | grep -o '"SERVICE_ROLE_KEY": *"[^"]*"' | head -1 | cut -d'"' -f4 || true)

if [ -z "$API_URL" ] || [ -z "$ANON_KEY" ]; then
  # Fallback a chiavi standard locali
  API_URL="http://127.0.0.1:54321"
  ANON_KEY=$(echo "$STATUS_JSON" | grep -o '"anon_key": *"[^"]*"' | head -1 | cut -d'"' -f4 || true)
  SERVICE_ROLE_KEY=$(echo "$STATUS_JSON" | grep -o '"service_role_key": *"[^"]*"' | head -1 | cut -d'"' -f4 || true)
fi

CONTENT="# Configurazione generata automaticamente per sviluppo locale
NEXT_PUBLIC_SUPABASE_URL=${API_URL:-http://127.0.0.1:54321}
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${ANON_KEY}
SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}
# In Docker (docker-compose) questo valore viene sovrascritto con host.docker.internal
SUPABASE_SERVER_URL=${API_URL:-http://127.0.0.1:54321}
NEXT_PUBLIC_APP_URL=http://localhost:3000
"

echo "Scrittura chiavi locali per Docker, test e app web..."
mkdir -p apps/web
printf "%s" "$CONTENT" > .env
printf "%s" "$CONTENT" > .env.local
printf "%s" "$CONTENT" > apps/web/.env.local

echo "✓ File d'ambiente aggiornati con successo!"
echo "Supabase API:       ${API_URL:-http://127.0.0.1:54321}"
echo "Supabase Studio:    http://127.0.0.1:54323"
echo "Supabase Inbucket:  http://127.0.0.1:54324"
