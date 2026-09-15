#!/usr/bin/env bash
# Standalone: push .env secrets to Cloudflare Worker (no echo of values)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API="$ROOT/apps/api"
cd "$API"

# shellcheck disable=SC1091
set -a
source "$ROOT/.env"
set +a

export PATH="$API/node_modules/.bin:$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID

SECRETS=(
  SCRAPECREATORS_API_KEY
  AIRTABLE_TOKEN
  AIRTABLE_API_KEY
  R2_ACCOUNT_ID
  R2_ACCESS_KEY_ID
  R2_SECRET_ACCESS_KEY
  R2_PUBLIC_BASE_URL
  INNGEST_EVENT_KEY
  INNGEST_SIGNING_KEY
)

for name in "${SECRETS[@]}"; do
  val="${!name-}"
  if [[ -z "$val" ]]; then
    echo "skip $name (empty)"
    continue
  fi
  printf '%s' "$val" | wrangler secret put "$name" >/dev/null
  echo "set  $name"
done

echo "deploying..."
wrangler deploy
