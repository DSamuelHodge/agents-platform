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
so a new or destructive tool is blocked until someone classifies it.

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
  department `policy.json` `mcp` ceiling, grant it in role manifests, `wrangler secret put MCP_TOKEN_<ID> --name agents-mcp-gateway`.
- **Add a skill:** add to `agents-skills` (with a `skills.manifest.json` entry), list it in the department `policy.json`
  `skills` and in role manifests, `sync-skills`, `generate`.
- **skills.sh:** there is no publish step; skills appear there via install telemetry. Set `DISABLE_TELEMETRY=1`
  for anything internal. Treat third-party skills as untrusted prompt text: review, then vendor at a pinned ref.

## First deployment

1. Fill `mcp-catalog.json`; create the 20 AI Gateways named in each `policy.json` (`dept-<slug>`) in the dashboard/IaC.
2. **Implement `packages/router/src/auth.ts`** (it fails closed: everyone gets 401 until you do), e.g. Cloudflare Access JWT
   verification and IdP-group mapping. Attach a route/custom domain to the router (it ships with `workers_dev: false`).
3. Deploy once (Actions → deploy), then `scripts/provision-secrets.sh` (`DRY_RUN=1` first), then set `MCP_TOKEN_<ID>` secrets.

## Verified vs not

Verified here (run, not assumed): all 20 Workers build with Flue 2.2.2 + Vite 8 + the Cloudflare plugin (150 DO classes,
bindings match migrations); `wrangler deploy --dry-run` passes for departments, gateway and router; 15 unit and
gateway integration tests pass (cross-department, privilege, forged-token, unclassified-tool cases); `validate` rejects
out-of-policy manifests; skills repo lints and `npx skills add <repo> --list` discovers all 21 skills.

**Not verified (needs your Cloudflare account):** a live deployment; agents actually running against Workers AI through a
named AI Gateway; live MCP servers (the gateway is tested against a stub, and SSE list-filtering only via unit test);
the `handoff` dispatch round trip in workerd; router authentication (deliberately unimplemented).
Also open: `useRole`/`requireCaller` are not type-checked in CI yet, and write-tier calls have no human approval gate
(Flue documents a pattern for one in its Tools guide; worth adding for Legal, Security and Sales writes).
