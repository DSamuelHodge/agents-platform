# agents-platform

150 agent roles across 20 departments, built with [Flue](https://flueframework.com), deployed on Cloudflare
(Workers, Durable Objects, Workers AI, AI Gateway). Skills live in a **separate repo** (`agents-skills`).
The MCP catalog lives in **`agents-mcps`** and is vendored here by `sync-mcp` (`mcp-catalog.json` + `mcp-catalog.lock.json`).
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
review each live `tools/list` in `agents-mcps` before `npm run list-mcp-tools -- --apply --reviewed` there. Auth notes: `agents-mcps/docs/mcp-auth-modes.md`.

Default least privilege: department leads (x.1 in your map) get the department ceiling; all other roles start
`read`-only. Widen a role by editing its manifest; `validate` refuses anything above the department policy.

### Why roles are top-level agents and not Flue subagents
Flue delegates cannot hold MCP connections and inherit none of the parent's tools, so a delegated role would run
without its scoped tools. Leads use a `handoff` tool that `dispatch`es to the teammate's own agent instance,
so every role runs inside its own grant. Delivery is at-least-once: make side effects idempotent.

## Layout

```
role-label-map.source.json     your map (identity source of truth)
mcp-catalog.json               VENDORED from agents-mcps (locked in mcp-catalog.lock.json)
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
scripts/                       generate, build-policy, sync-skills, validate, provision-secrets, put-mcp-tokens
mcp-tokens.present.json        names of MCP_TOKEN_* secrets that exist (never values)
```

## Daily workflow

```bash
npm install
npm run sync-skills -- --source git@github.com:YOUR_ORG/agents-skills.git --ref <sha-or-tag>   # pin!
npm run generate && npm run build-policy
npm run check            # validate + staleness + tests. CI runs this and builds all 20 Workers
```

- **Edit a role:** change `departments/<d>/roles/<slug>.json`, then `npm run generate && npm run build-policy`.
- **MCP credentials:** role JSON lists every intended server. `generate` mounts only grants whose `MCP_TOKEN_<DEPT>_<ID>` is in `.env` or `mcp-tokens.present.json` (names only). Adding a password to `.env` / `put-mcp-tokens` and regenerating turns that server on; missing passwords are left off so the agent can boot.
- **Add a role:** add it to your map, add `roles/<slug>.json`, generate. A migration is appended automatically.
  **Never rename an agent function or remove a migration**: the function name is the Durable Object's storage identity.
- **Add an MCP server:** edit `agents-mcps` (`mcp-catalog.json`, `npm run list-mcp-tools`), pin it with
  `npm run sync-mcp -- --source ../agents-mcps` (or `--ref <sha>`), then add it to the department `policy.json`
  ceiling and role manifests. `wrangler secret put MCP_TOKEN_<DEPT>_<ID> --name agents-mcp-gateway`.
- **Add a skill:** add to `agents-skills` (with a `skills.manifest.json` entry), list it in the department `policy.json`
  `skills` and in role manifests, `sync-skills`, `generate`.
- **skills.sh:** there is no publish step; skills appear there via install telemetry. Set `DISABLE_TELEMETRY=1`
  for anything internal. Treat third-party skills as untrusted prompt text: review, then vendor at a pinned ref.

## Layers

Product goal: route work to the right department and escalate when needed. Status lives in `FINISH.md`.

| # | Layer | Status |
|---|---|---|
| 1 | Agents can start and use tools | Boot works. Generate mounts only MCP servers with a present gateway secret. Live GitHub read through the router is proven. Cloudflare MCP read through the router is not. |
| 2 | Agents know how to do real work | Not started. Playbooks are placeholders. |
| 3 | Agents can pass work to other departments | Not built. Handoff is same-department only. |
| 4 | Something decides who gets incoming work | Not built. |

## Live deployment

Public hostname: `https://agents.hodgederrick.com` (Access team `https://zerothinking.cloudflareaccess.com`,
application **Agents Router**, `POLICY_AUD` `616e79a89317c4299483101242cf4e34c5dbc5cca482b652763f761a8ccf5a7d`).
Allow-list is `dshodge2020@outlook.com` and `hodgedomain@gmail.com` only (no `*@hodgederrick.com`).
`access-email-groups.json` is the Worker group map: those two addresses are `admin`; everyone else must be
listed as `dept:<slug>` and/or `role:<slug>`. Router `workers_dev` is false. There is no workers.dev hostname
and no service-token path.

All 20 `agents-<slug>` Workers, `agents-mcp-gateway`, and `agents-router` (full `wrangler.jsonc` service
bindings) are deployed. HMAC `DEPT_KEY` / `CALLER_KEY` maps are on the Workers. Named AI Gateways
`dept-<slug>` exist. Legal, Security and Sales have `APPROVAL_CODE`; write-tier MCP stays unusable until
`record_write_approval` is called with that code.

`packages/router/wrangler.bootstrap.jsonc` stays in the repo for a first-time account with no department
Workers. Do not use it on this account.

Redeploy a department from its directory: `npm run deploy` (`vite build && wrangler deploy`). After role or
token-inventory edits: `npm run generate && npm run build-policy`, then deploy the departments that changed.

## Verified vs not

Verified locally: all 20 Workers build with Flue 2.2.2 + Vite 8 + the Cloudflare plugin (150 DO classes,
bindings match migrations); unit and gateway integration tests (cross-department, privilege, forged-token,
unclassified-tool, Access JWT, write-approval gate, MCP present-token filter); `validate` rejects
out-of-policy manifests; `tsc` type-checks `useRole` and `requireCaller`; skills repo lints.

Live (account `Derrick Hodge Account`):

- 20 named AI Gateways; Workers AI `@cf/moonshotai/kimi-k2.6` returned `pong` via `dept-sales`.
- `https://agents.hodgederrick.com` 302s unauthenticated traffic to Zero Trust.
- Catalog `auth.header`/`auth.scheme` (Sentry `Sentry-Bearer`, PagerDuty `Token token=`).
- Ten GitHub and six Cloudflare `MCP_TOKEN_<DEPT>_<ID>` secrets on the gateway (names in `mcp-tokens.present.json`).
- Admin GitHub read through Access → router → backend-development → gateway (`get_file_contents` listed repo files including `FINISH.md`).
- `mcp-catalog.json` uses vendor Streamable HTTP URLs. Drive host is `https://drivemcp.googleapis.com/mcp/v1`. See `agents-mcps/docs/mcp-auth-modes.md` before any new `MCP_TOKEN_*`.

Still open: Cloudflare MCP read through the live router; OAuth-only vendors (no broker, so no `MCP_TOKEN_*` and generate leaves them unmounted); Snowflake tenant URL; tool-list drafts in `agents-mcps`; layers 2–4 in `FINISH.md`.
