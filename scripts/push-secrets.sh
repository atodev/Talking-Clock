#!/usr/bin/env bash
# Copies secrets from the macOS Keychain into the linked Vercel project.
# Values are piped straight into the Vercel CLI and never printed.
set -euo pipefail
cd "$(dirname "$0")/.."

SERVICE="chronovoice"
NAMES=(GEMINI_API_KEY APP_PASSCODE)

if [ ! -f .vercel/project.json ]; then
  echo "✗ This folder isn't linked to a Vercel project yet. Run: vercel link" >&2
  exit 1
fi

for NAME in "${NAMES[@]}"; do
  VALUE="$(security find-generic-password -s "$SERVICE" -a "$NAME" -w 2>/dev/null)" || {
    echo "✗ $NAME is not in the Keychain (service: $SERVICE)" >&2
    exit 1
  }
  # Vercel's output never contains the value; keep it only to show if something fails
  if ! OUTPUT="$(printf '%s' "$VALUE" \
      | vercel env add "$NAME" --environment production --sensitive --force 2>&1)"; then
    unset VALUE
    echo "✗ Couldn't set $NAME in Vercel:" >&2
    echo "$OUTPUT" >&2
    exit 1
  fi
  unset VALUE
  echo "✓ $NAME set in Vercel production (value not shown)"
done
