#!/usr/bin/env bash
# Generates one HMAC key pair per department and stores them as Worker secrets.
#   DEPT_KEY    department Worker -> gateway   (signs MCP tokens)
#   CALLER_KEY  router -> department Worker    (signs caller tokens)
# The gateway receives DEPT_KEYS (map of all departments); the router receives CALLER_KEYS.
# A compromised department Worker can only ever forge its own department.
# Deploy each Worker once before running this, or `wrangler secret put` will offer to create a draft.
# Re-run to rotate. Upstream MCP credentials are separate: wrangler secret put MCP_TOKEN_<ID> --name agents-mcp-gateway
set -euo pipefail
cd "$(dirname "$0")/.."
DRY="${DRY_RUN:-0}"
put() { # name value worker
  if [ "$DRY" = "1" ]; then echo "[dry-run] secret $1 -> $3"; else printf %s "$2" | npx wrangler secret put "$1" --name "$3" >/dev/null; echo "set $1 on $3"; fi
}
deptkeys='{}'; callerkeys='{}'
for slug in $(node -e "for (const s of JSON.parse(require('child_process').execSync('node scripts/list-departments.mjs'))) console.log(s)"); do
  dk=$(openssl rand -base64 32); ck=$(openssl rand -base64 32)
  put DEPT_KEY "$dk" "agents-$slug"; put CALLER_KEY "$ck" "agents-$slug"
  deptkeys=$(node -e "const o=JSON.parse(process.argv[1]);o[process.argv[2]]=process.argv[3];console.log(JSON.stringify(o))" "$deptkeys" "$slug" "$dk")
  callerkeys=$(node -e "const o=JSON.parse(process.argv[1]);o[process.argv[2]]=process.argv[3];console.log(JSON.stringify(o))" "$callerkeys" "$slug" "$ck")
done
put DEPT_KEYS "$deptkeys" agents-mcp-gateway
put CALLER_KEYS "$callerkeys" agents-router
