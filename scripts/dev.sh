#!/usr/bin/env bash
# Starts the dev server with secrets from the Keychain, so no secret file is needed on disk.
set -euo pipefail
cd "$(dirname "$0")/.."
export GEMINI_API_KEY="$(security find-generic-password -s chronovoice -a GEMINI_API_KEY -w)"
export APP_PASSCODE="$(security find-generic-password -s chronovoice -a APP_PASSCODE -w)"
exec npm run dev
