# Finish the agents-platform rollout

Run commands from `C:\Users\Derrick\Downloads\agents-platform\agents-platform` unless a step says otherwise. On this machine use `npm.cmd`. PowerShell does not accept `&&`. `npx.ps1` is blocked by execution policy; use `npm.cmd exec -- wrangler ...`. Do not paste secret values into chat.

Account: `6c2dbbe47de58a74542ad9a5d9dd5b2b` (Derrick Hodge Account). Public hostname: `https://agents.hodgederrick.com`. Access team: `https://zerothinking.cloudflareaccess.com`. `POLICY_AUD`: `616e79a89317c4299483101242cf4e34c5dbc5cca482b652763f761a8ccf5a7d`.

The catalog split, Access JWT check, admin map, per-server auth schemes, `workers_dev: false`, HMAC maps, twenty department Workers, the gateway, the full router, GitHub/Cloudflare `MCP_TOKEN_*` names, and generate-time MCP mounting are already done.

## Layers and status

Work is routed to the right department and escalated when needed. That has four layers. Each layer needs the one before it.

| # | Layer | Status |
|---|---|---|
| 1 | Agents can start and use tools | **Done for boot.** Generate mounts only MCP grants whose `MCP_TOKEN_<DEPT>_<ID>` is in `.env` or `mcp-tokens.present.json` (names only). Role JSON stays complete. All 20 department Workers are deployed with that filter. A live GitHub read through Access → router HMAC → department Worker → gateway succeeded (`get_file_contents` on `DSamuelHodge/agents-platform`, including `FINISH.md`). Cloudflare MCP read through the same path is still unproven. Unauthenticated hits still 302 at Access (not a Worker 401). |
| 2 | Agents know how to do real work | **Not started.** All 20 department playbooks are placeholder text in `agents-skills`. |
| 3 | Agents can pass work to other departments | **Not built.** `handoff` only reaches teammates in the same department Worker. |
| 4 | Something decides who gets incoming work | **Not built.** No triage agent or inbound router that picks a department. |

Do not start layer 2 until layer 1 stays green (`npm.cmd run check`, agents boot, GitHub read still works). Do not invent a shared token and copy it onto every department.

## Done (keep these true)

1. **Pilot and widened GitHub/Cloudflare secrets** live on `agents-mcp-gateway` as `MCP_TOKEN_<DEPT>_<ID>`. Inventory of *names* (never values) is `mcp-tokens.present.json`. Today that is 10 GitHub + 6 Cloudflare department tokens. Isolation is one secret name per department×server; GitHub PATs still share the same 56-repo surface until those PATs are repo-sliced.
2. **Gateway, 20 department Workers, and `agents-router`** (full `wrangler.jsonc` service bindings) are deployed. Department deploy is `npm run deploy` from `departments/<slug>` (`vite build && wrangler deploy`). Router: `npm.cmd exec -- wrangler deploy --config packages/router/wrangler.jsonc`.
3. **HMAC:** distinct `DEPT_KEY` / `CALLER_KEY` per department; `DEPT_KEYS` on the gateway; `CALLER_KEYS` on the router; `APPROVAL_CODE` on legal, security, and sales.
4. **Access:** application **Agents Router** allows only `dshodge2020@outlook.com` and `hodgedomain@gmail.com`. No service-token path on the router. `access-email-groups.json` is the Worker map (those two are `admin`).
5. **Generate filter:** `scripts/generate.mjs` writes `{ ...manifest, mcp: <mounted only> }`. Missing Jira/Sentry/OAuth hosts do not connect at boot. Adding a password to `.env`, `npm.cmd run put-mcp-tokens`, `npm.cmd run generate`, and redeploying that department turns the server on.
6. **Step-6 GitHub proof:** conversation `step6-d` completed through the live router. Temporary Access Service Auth / role JSON edits used for that probe were reverted.

## Remaining on layer 1

- Prove one Cloudflare MCP read through the router for a department that has `MCP_TOKEN_*_CLOUDFLARE` (frontend, devops, backend, full-stack, security, or architecture). Expect a real tools/list or read, not `-32003` and not upstream 401.
- Unauthenticated `https://agents.hodgederrick.com` still 302s to Access. A request that reaches the Worker with no JWT must 401. Do not add a Service Auth hole to make curl easier.
- Optional: slice GitHub PATs so each department sees only its repos. Names are already isolated.

## Layer 2 (next after layer 1 stays green)

Replace the 20 placeholder playbooks in `agents-skills` with real operating procedures, pin with `npm.cmd run sync-skills`, then `npm.cmd run generate` and redeploy the departments that changed.

## Layer 3

Cross-department handoff (a lead in one Worker dispatching to a role in another) is not in the harness. Same-department `handoff` already exists.

## Layer 4

Inbound triage: something that reads a request and chooses `department` + `role`. The public router today requires the caller to name both in the path.

## People (when you need them)

`access-email-groups.json` maps only the two admin emails. Anyone else who passes Access still cannot invoke a role until their email is listed with `dept:<slug>` or `role:<slug>`. Do not put `admin` on any other address. Do not add `*@hodgedomain.com` or `*@hodgederrick.com`. After editing:

```powershell
npm.cmd run generate
npm.cmd run check
npm.cmd exec -- wrangler deploy --config packages/router/wrangler.jsonc
```

Add the same people to Access policy **Allow Hodge**. Access and the Worker map are separate.

## Leave these undone on purpose

- No OAuth broker Worker. Notion, Slack, Figma, Drive, Salesforce, HubSpot, and the other OAuth-only hosts in `agents-mcps/docs/mcp-auth-modes.md` get no `MCP_TOKEN_*`. Generate leaves them unmounted.
- No service-token or client-id path on the router.
- Snowflake's catalog URL is still the tenant template `org-account.snowflakecomputing.com`. Replace it in `agents-mcps`, commit, then `npm run sync-mcp` in the platform and commit the new lock.
- Do not merge unread `mcp-catalog.overrides.draft.json`.
- Do not rename Flue agent functions or delete Durable Object migrations.
- Do not run `list-mcp-tools --apply` from the platform. Tool-name overrides stay in `agents-mcps` and are reviewed by hand.

## Done when

- Layer 1: agents boot (`mcp` only for present secrets), `npm.cmd run check` passes, GitHub read through the router still works, one Cloudflare read through the router works, unauthenticated traffic is Access 302 or Worker 401 with no Service Auth bypass.
- Layer 2: playbooks are real procedures, not placeholders.
- Layer 3: work can move to another department's Worker.
- Layer 4: inbound work is assigned without the caller hard-coding department and role.
