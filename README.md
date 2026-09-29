# agents-platform

150 agent roles across 20 departments, built with [Flue](https://flueframework.com), deployed on Cloudflare
(Workers, Durable Objects, Workers AI, AI Gateway). Skills live in a **separate repo** (`agents-skills`,
Agent Skills format, discoverable by `npx skills` / skills.sh). MCP access is brokered by a private gateway.

Source of truth for identity: `role-label-map.source.json` (your map). Everything else is derived or validated against it.

## Architecture

```
user/system ─► router ──(service binding + signed caller token)──► department Worker (x20)
                                                                      │  one Durable Object class per role (150 total)
                                                                      │  lead ──handoff(dispatch)──► teammate roles
                                                                      ▼
                                         MCP calls: service binding + short-lived signed token
                                                                      ▼
                                              mcp-gateway (private) ── holds ALL upstream credentials
                                                                      ▼
                                                              upstream MCP servers
```

**The department is the trust boundary; the prompt is not.** Scoping is enforced structurally:

| Layer | Scoped by | Enforced by |
|---|---|---|
| Skills | department allowlist, then role subset | Only allowed skills are vendored into that department's Worker (bundled at build) |
| MCP | department ceiling, then role grant, per tool tier | Gateway: verifies signed token, then `authorize()`; `tools/list` is filtered; default-deny |
| Models | department allowlist | `flue({ providers })` derived from policy: other providers are not bundled |
| Spend/logs | department | Named AI Gateway `dept-<slug>` registered in each `app.ts` |
| Data | department | Per-Worker bindings only (add R2/D1/Vectorize per department in its `wrangler.jsonc`) |
| Entry | role | Router authenticates + authorizes; department Worker re-verifies a per-department signed token that names the role |

MCP tools are classified into tiers `read < write < admin` by naming convention plus explicit `overrides` in
`mcp-catalog.json`. **Unrecognised tool names are `admin`** (denied unless a department ceiling allows it),
so a new or destructive tool is blocked until someone classifies it. Default verbs include `download` as
**read** (a read-only role can pull Drive file bytes) and `copy` as **write**. Name-based tiers are a heuristic:
review each live `tools/list` before `npm run list-mcp-tools -- --apply --reviewed`. See `docs/mcp-auth-modes.md`.

Default least privilege: department leads (x.1 in your map) get the department ceiling; all other roles start
`read`-only. Widen a role by editing its manifest; `validate` refuses anything above the department policy.

### Why roles are top-level agents and not Flue subagents
Flue delegates cannot hold MCP connections and inherit none of the parent's tools, so a delegated role would run
without its scoped tools. Leads use a `handoff` tool that `dispatch`es to the teammate's own agent instance,
so every role runs inside its own grant. Delivery is at-least-once: make side effects idempotent.

## Layout

```
role-label-map.source.json     your map (identity source of truth)
mcp-catalog.json               MCP servers (REPLACE the placeholder URLs), tier overrides
departments/<slug>/
  policy.json                  ceiling: MCP servers+tier, skills, models, AI Gateway id
  roles/<role-slug>.json       ONE FILE PER ROLE: persona, model, skills, mcp grants, delegatesTo  (edit these)
  src/agents/*.ts              GENERATED 'use agent' modules
  src/app.ts                   GENERATED routes + caller auth + gateway-bound provider
  src/skills/                  VENDORED from agents-skills (locked in skills.lock.json)
  wrangler.jsonc               authored once; generator only APPENDS new DO migrations
packages/policy-core           tiers, authorize(), HMAC tokens (unit tested)
packages/harness               useRole(), handoff tool, requireCaller()
packages/gateway               MCP gateway Worker (+ policy.generated.json)
packages/router                the only entry point
scripts/                       generate, build-policy, sync-skills, validate, provision-secrets
```

## Daily workflow

```bash
npm install
npm run sync-skills -- --source git@github.com:YOUR_ORG/agents-skills.git --ref <sha-or-tag>   # pin!
npm run generate && npm run build-policy
npm run check            # validate + staleness + tests. CI runs this and builds all 20 Workers
```

- **Edit a role:** change `departments/<d>/roles/<slug>.json`, then `npm run generate && npm run build-policy`.
- **Add a role:** add it to your map, add `roles/<slug>.json`, generate. A migration is appended automatically.
  **Never rename an agent function or remove a migration**: the function name is the Durable Object's storage identity.
- **Add an MCP server:** add to `mcp-catalog.json`, run `tools/list` against it and add `overrides`, add to the
  department `policy.json` `mcp` ceiling, grant it in role manifests,
  `wrangler secret put MCP_TOKEN_<DEPT>_<ID> --name agents-mcp-gateway`
  (e.g. `MCP_TOKEN_SALES_SALESFORCE`). Then `npm run list-mcp-tools` to draft `overrides` from a live `tools/list`.
- **Add a skill:** add to `agents-skills` (with a `skills.manifest.json` entry), list it in the department `policy.json`
  `skills` and in role manifests, `sync-skills`, `generate`.
- **skills.sh:** there is no publish step; skills appear there via install telemetry. Set `DISABLE_TELEMETRY=1`
  for anything internal. Treat third-party skills as untrusted prompt text: review, then vendor at a pinned ref.

## First deployment

1. Fill `mcp-catalog.json`; create the 20 AI Gateways named in each `policy.json` (`dept-<slug>`) in the dashboard/IaC.
2. Router Access is live: team `https://zerothinking.cloudflareaccess.com`, application **Agents Router**
   (`POLICY_AUD` `616e79a89317c4299483101242cf4e34c5dbc5cca482b652763f761a8ccf5a7d`) in front of
   `https://agents.hodgederrick.com` and `https://agents-router.dshodge2020.workers.dev`.
   Access allow-list is those two emails only (no `*@hodgederrick.com`).
   `access-email-groups.json` is the Worker group map: those two addresses are `admin`;
   everyone else must be listed as `dept:<slug>` and/or `role:<slug>`.
   Access sits on the custom domain. Router `workers_dev` is false so there is no second hostname.
   The Worker is currently deployed without department service bindings (those Workers are not on the account yet);
   use `wrangler.jsonc` (with services) once the 20 department Workers exist. Until then deploy with
   `packages/router/wrangler.bootstrap.jsonc`.
3. Create the 20 named AI Gateways: `CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… node scripts/create-ai-gateways.mjs`
4. Deploy once (Actions → deploy), then `scripts/provision-secrets.sh` (`DRY_RUN=1` first), then set
   `MCP_TOKEN_<DEPT>_<ID>` secrets (one upstream credential per department and catalog server).
   Legal, Security and Sales also get an `APPROVAL_CODE` secret; write-tier MCP stays unusable until
   `record_write_approval` is called with that code.

## Verified vs not

Verified locally: all 20 Workers build with Flue 2.2.2 + Vite 8 + the Cloudflare plugin (150 DO classes,
bindings match migrations); `wrangler deploy --dry-run` passes for departments, gateway and router; unit and
gateway integration tests (cross-department, privilege, forged-token, unclassified-tool, Access JWT, write-approval
gate); `validate` rejects out-of-policy manifests; `tsc` type-checks `useRole` and `requireCaller`; skills repo lints.

Live account work (this pass, account `Derrick Hodge Account`):

- Created all 20 named AI Gateways (`dept-agile-scrum` … `dept-user-research-experience`).
- Workers AI `@cf/moonshotai/kimi-k2.6` returned `pong` (request routed with gateway id `dept-sales`).
- Deployed `agents-live-probe` on `*.dshodge2020.workers.dev`: HMAC MCP token sign/verify against a stub `tools/list`, forged key denied; same-isolate handoff analogue returned `ack:qualify ACME`.

- Router Access: `https://agents.hodgederrick.com` 302s to Zero Trust. Router `workers_dev` is false. Catalog `auth.header`/`auth.scheme` (Sentry `Sentry-Bearer`, PagerDuty `Token token=`). GitHub/Cloudflare tokens go on via `npm run put-mcp-tokens` once you mint scoped per-department credentials.
- `mcp-catalog.json` uses vendor Streamable HTTP URLs. Drive host is `https://drivemcp.googleapis.com/mcp/v1`. See `docs/mcp-auth-modes.md` before any `MCP_TOKEN_*`.

Still needs you: department Workers (router full `wrangler.jsonc` service bindings); `MCP_TOKEN_<DEPT>_<ID>` secrets (OAuth vendors need a service-account token, not a user login); Google Drive host is `https://drivemcp.googleapis.com/mcp/v1` (OAuth); Snowflake tenant URL. `npm run list-mcp-tools` drafts overrides once a `tools/list` succeeds.
