#!/usr/bin/env bash
# Deploys a GitHub branch (default: main) to Vercel production and waits for the result.
# Vercel builds from GitHub, so local files (like .env.local) are never uploaded.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

BRANCH="${1:-main}"
read -r PROJECT TEAM < <(python3 -c "import json; p=json.load(open('.vercel/project.json')); print(p['projectName'], p['orgId'])")
REPO="$(git remote get-url origin | sed -E 's#^(git@github.com:|https://github.com/)##; s#\.git$##')"
REPO_ID="$(gh api "repos/$REPO" --jq .id)"

BODY_FILE="$(mktemp)"; trap 'rm -f "$BODY_FILE"' EXIT
printf '{"name":"%s","project":"%s","target":"production","gitSource":{"type":"github","repoId":%s,"ref":"%s"}}' \
  "$PROJECT" "$PROJECT" "$REPO_ID" "$BRANCH" > "$BODY_FILE"
ID="$(vercel api "/v13/deployments?teamId=$TEAM&forceNew=1&skipAutoDetectionConfirmation=1" -X POST --input "$BODY_FILE" --raw 2>/dev/null \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['id']) if 'id' in d else sys.exit('✗ ' + json.dumps(d.get('error', d)))")"
echo "Deploying $REPO@$BRANCH to $PROJECT ($ID)"

for _ in $(seq 1 60); do
  STATE="$(vercel api "/v13/deployments/$ID?teamId=$TEAM" --raw 2>/dev/null \
    | python3 -c "import json,sys; print(json.load(sys.stdin).get('readyState'))")"
  echo "  $(date +%T) $STATE"
  case "$STATE" in
    READY) echo "✓ Live"; exit 0 ;;
    ERROR|CANCELED) echo "✗ Deployment $STATE. Logs: vercel inspect $ID --logs" >&2; exit 1 ;;
  esac
  sleep 10
done
echo "✗ Timed out waiting for $ID" >&2; exit 1
