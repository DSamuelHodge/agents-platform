# Finish the agents-platform rollout

This is the remaining work. The catalog split, Access JWT check, admin map, per-server auth schemes, and `workers_dev: false` on the router are already done. Do these steps in order. Do not invent a shared token and copy it onto every department.

Run commands from `C:\Users\Derrick\Downloads\agents-platform\agents-platform` unless a step says otherwise. On this machine use `npm.cmd`. PowerShell does not accept `&&`. `npx.ps1` is blocked by execution policy; use `npm.cmd exec -- wrangler ...`.

Account: `6c2dbbe47de58a74542ad9a5d9dd5b2b` (Derrick Hodge Account), email `dshodge2020@outlook.com`.

The connected Cloudflare session can read the account. It returns **9109** on `/user/tokens`, so it cannot create API tokens. The GitHub connection cannot create personal access tokens. Those two clicks stay in the dashboards.

## 1. Mint the pilot credentials

Create **six separate secrets**. One GitHub fine-grained PAT and one Cloudflare API token per pilot department: backend, frontend, devops.

Do not paste the secret values into chat. Set them only in the shell you will use for `put-mcp-tokens`.

### GitHub

For each department, open https://github.com/settings/personal-access-tokens/new (fine-grained, not classic).

- Name it `agents-<department>-github`, for example `agents-backend-development-github`.
- Resource owner: `DSamuelHodge`.
- Repository access: only the repos that department should read or change. For the first live read, Contents: Read is enough. Add Contents: Write later only for departments whose role grant is `write`.
- No account-wide Administration permission.

Save the token once. GitHub will not show it again.

### Cloudflare

For each department, open https://dash.cloudflare.com/profile/api-tokens and create a **Custom token**. Do not use the Global API Key, and do not reuse the Wrangler OAuth login.

- Name it `agents-<department>-cloudflare`.
- Account resources: only account `6c2dbbe47de58a74542ad9a5d9dd5b2b`.
- Permissions: only what that department should call through `https://mcp.cloudflare.com/mcp`. Start with read permissions (account and Workers read). Add edit permissions later only where `departments/<slug>/policy.json` grants `cloudflare` write.
- The token that creates other API tokens needs **API Tokens Write**. The current MCP login does not have that, which is why this step is manual.

### Environment variable names

```text
MCP_TOKEN_BACKEND_DEVELOPMENT_GITHUB
MCP_TOKEN_FRONTEND_DEVELOPMENT_GITHUB
MCP_TOKEN_DEVOPS_INFRASTRUCTURE_GITHUB
MCP_TOKEN_BACKEND_DEVELOPMENT_CLOUDFLARE
MCP_TOKEN_FRONTEND_DEVELOPMENT_CLOUDFLARE
MCP_TOKEN_DEVOPS_INFRASTRUCTURE_CLOUDFLARE
```

PowerShell, for the current window only:

```powershell
$env:MCP_TOKEN_BACKEND_DEVELOPMENT_GITHUB = '<paste>'
# repeat for the other five
```

## 2. Put those six secrets on the gateway

The Worker `agents-mcp-gateway` does not exist yet. Deploy it once so `secret put` has a script to attach to. It stays private (`workers_dev: false`). It will reject calls until `DEPT_KEYS` exists (step 5). That is expected.

```powershell
npm.cmd exec -- wrangler deploy --config packages/gateway/wrangler.jsonc
$env:DRY_RUN = '1'
npm.cmd run put-mcp-tokens -- github,cloudflare
Remove-Item Env:DRY_RUN
npm.cmd run put-mcp-tokens -- github,cloudflare
```

Dry-run must print the six pilot names as set, and the other GitHub and Cloudflare department names as `(env unset)`. The real run must print `set MCP_TOKEN_... on agents-mcp-gateway` for the six only. A missing env var fails the script. Do not export the other departments' names yet.

Confirm names only (values are not listed):

```powershell
npm.cmd exec -- wrangler secret list --name agents-mcp-gateway
```

## 3. Deploy the twenty department Workers

Each department Worker is `agents-<slug>` and binds to the gateway. Deploy all of them before the full router config. From the repo root, one department at a time:

```powershell
npm.cmd run deploy -w departments/backend-development
npm.cmd run deploy -w departments/frontend-development
npm.cmd run deploy -w departments/devops-infrastructure
```

Then the other seventeen: agile-scrum, business-analysis-requirements, customer-support, data-engineering-analytics, design, documentation-technical-writing, full-stack-development, legal-compliance, marketing, mobile-development, product-management-strategy, project-management, quality-assurance-testing, sales, security-compliance, software-architecture, user-research-experience.

`wrangler deploy` for a department runs `vite build` first. If a deploy fails on a missing gateway binding, the gateway from step 2 must already exist.

## 4. Generate HMAC keys

`scripts/provision-secrets.sh` creates a distinct `DEPT_KEY` and `CALLER_KEY` per department Worker, writes the map `DEPT_KEYS` onto `agents-mcp-gateway`, writes `CALLER_KEYS` onto `agents-router`, and writes `APPROVAL_CODE` onto `agents-legal-compliance`, `agents-security-compliance`, and `agents-sales`.

The script is bash and uses `openssl`. Run it from Git Bash or WSL, not from PowerShell:

```bash
DRY_RUN=1 bash scripts/provision-secrets.sh
bash scripts/provision-secrets.sh
```

Re-running rotates every key. After a rotation, department Workers and the router must be called with the new secrets already stored (the script writes them). Keep the printed `APPROVAL_CODE` values somewhere you control. Write-tier MCP for legal, security, and sales stays blocked until `record_write_approval` is called with that code.

## 5. Redeploy the router with service bindings

The live router was deployed from `packages/router/wrangler.bootstrap.jsonc` because the department Workers did not exist. After step 3 and step 4:

```powershell
npm.cmd exec -- wrangler deploy --config packages/router/wrangler.jsonc
```

Leave `packages/router/wrangler.bootstrap.jsonc` in the repo. Do not turn `workers_dev` back on. The only public hostname is `https://agents.hodgederrick.com`. Access application **Agents Router** (`POLICY_AUD` `616e79a89317c4299483101242cf4e34c5dbc5cca482b652763f761a8ccf5a7d`) already allows only `dshodge2020@outlook.com` and `hodgedomain@gmail.com`.

## 6. Prove one read through the gateway

`agents-mcp-gateway` has no public URL. The proof goes through the router as an admin user.

1. Sign in to Cloudflare Access as `dshodge2020@outlook.com` or `hodgedomain@gmail.com` at `https://agents.hodgederrick.com`.
2. Call a backend role that is granted GitHub read, for example `POST /backend-development/<role>/run` with a prompt that only lists or reads a file in a repo that the backend PAT can see.
3. Confirm the gateway reached GitHub: a real file listing or file body, not a JSON-RPC error `-32003` (missing secret) and not an upstream 401.
4. Repeat one Cloudflare read with the frontend or devops token (something the token's read permissions allow).
5. Confirm a department that has no Cloudflare grant cannot call Cloudflare, and a call with no `Cf-Access-Jwt-Assertion` still returns 401.

Do not run `list-mcp-tools --apply`. Tool-name overrides stay in `agents-mcps` and are reviewed by hand.

## 7. Widen GitHub and Cloudflare only after the pilot read works

Same minting rules as step 1. One token per department. Then `npm.cmd run put-mcp-tokens -- github,cloudflare` with every name below set.

GitHub (10):

```text
MCP_TOKEN_BACKEND_DEVELOPMENT_GITHUB
MCP_TOKEN_DATA_ENGINEERING_ANALYTICS_GITHUB
MCP_TOKEN_DEVOPS_INFRASTRUCTURE_GITHUB
MCP_TOKEN_DOCUMENTATION_TECHNICAL_WRITING_GITHUB
MCP_TOKEN_FRONTEND_DEVELOPMENT_GITHUB
MCP_TOKEN_FULL_STACK_DEVELOPMENT_GITHUB
MCP_TOKEN_MOBILE_DEVELOPMENT_GITHUB
MCP_TOKEN_QUALITY_ASSURANCE_TESTING_GITHUB
MCP_TOKEN_SECURITY_COMPLIANCE_GITHUB
MCP_TOKEN_SOFTWARE_ARCHITECTURE_GITHUB
```

Cloudflare (6):

```text
MCP_TOKEN_BACKEND_DEVELOPMENT_CLOUDFLARE
MCP_TOKEN_DEVOPS_INFRASTRUCTURE_CLOUDFLARE
MCP_TOKEN_FRONTEND_DEVELOPMENT_CLOUDFLARE
MCP_TOKEN_FULL_STACK_DEVELOPMENT_CLOUDFLARE
MCP_TOKEN_SECURITY_COMPLIANCE_CLOUDFLARE
MCP_TOKEN_SOFTWARE_ARCHITECTURE_CLOUDFLARE
```

## 8. Let other people in

`access-email-groups.json` maps only the two admin emails. Anyone else who passes the Access policy still cannot invoke a role until their email is listed with `dept:<slug>` or `role:<slug>`. Do not put `admin` on any other address. Do not add `*@hodgedomain.com` or `*@hodgederrick.com`.

After editing the file:

```powershell
npm.cmd run generate
npm.cmd run check
npm.cmd exec -- wrangler deploy --config packages/router/wrangler.jsonc
```

Add the same people to the Access application policy **Allow Hodge** if they are not already one of the two emails. Access and the Worker map are separate. Both have to allow the person.

## 9. Leave these undone on purpose

- No OAuth broker Worker. Notion, Slack, Figma, Drive, Salesforce, HubSpot, and the other OAuth-only hosts in `agents-mcps/docs/mcp-auth-modes.md` get no `MCP_TOKEN_*`.
- No service-token or client-id path on the router. CI has no way in until that is designed.
- Snowflake's catalog URL is still the tenant template `org-account.snowflakecomputing.com`. Replace it in `agents-mcps`, commit, then `npm run sync-mcp` in the platform and commit the new lock.
- Do not merge unread `mcp-catalog.overrides.draft.json`.
- Do not rename Flue agent functions or delete Durable Object migrations.

## Done when

- `wrangler secret list --name agents-mcp-gateway` shows `DEPT_KEYS` plus the GitHub and Cloudflare names you minted, and no others.
- All 20 `agents-<slug>` Workers and `agents-router` (full `wrangler.jsonc`) are deployed.
- `https://agents.hodgederrick.com` still redirects to `zerothinking.cloudflareaccess.com`, and a request with no JWT returns 401 from the Worker.
- One GitHub read and one Cloudflare read succeed through the router for a pilot department, using that department's own token.
- `npm.cmd run check` passes in `agents-platform`.
