# Vendor MCP authentication modes

Gateway secrets are `MCP_TOKEN_<DEPT>_<ID>`. Catalog `auth: { header, scheme }` controls the upstream header
(default `Authorization` / `Bearer`). Sentry uses `Sentry-Bearer`; PagerDuty API keys use `Token token=`.
Do not put those secrets on the gateway until Access JWT verification and the email-to-group map are live.

Where a vendor only offers per-user OAuth, a static bearer is not a substitute. Use a service account or token-exchange flow; actions then belong to that service identity.

`download` is classified as **read**. A read-only role can pull Drive file bytes. Keep that unless a department needs it denied via `overrides`.

Do not run `npm run list-mcp-tools -- --apply --reviewed` until a human has read `mcp-catalog.overrides.draft.json`. Name-based tiers are a heuristic.

| Catalog id | Hosted URL | Documented auth | Static / service credential for the gateway? | Notes |
|---|---|---|---|---|
| github | `https://api.githubcopilot.com/mcp/` | OAuth **or** GitHub PAT (`Authorization: Bearer`) | **Yes** — fine-grained PAT or GitHub App installation token per department | Scope the PAT/App to that department’s repos. |
| jira | `https://mcp.atlassian.com/v2/mcp` | OAuth 2.1 primary; org-admin can enable **API token / service-account key** for M2M | **If org enables API tokens** — service account key as Bearer/Basic | Else interactive OAuth only. |
| notion | `https://mcp.notion.com/mcp` | **OAuth 2.0 + PKCE only** on the hosted server | **No** on hosted MCP | Self-hosted OSS server uses `NOTION_TOKEN`. Hosted: “does not support bearer token authentication”. |
| google-drive | `https://drivemcp.googleapis.com/mcp/v1` | **OAuth 2.0** (Drive MCP API) | **Not as a static Bearer** on this host | Google docs specify OAuth client. `tools/list` can return 200 without auth; **calls need OAuth**. Local/community servers can use a service account. |
| slack | `https://mcp.slack.com/mcp` | Confidential OAuth (user tokens) | **No documented static PAT for hosted MCP** | Community stdio servers accept `xoxb`/`xoxp`. Hosted MCP is OAuth. Actions as the authorizing user. |
| figma | `https://mcp.figma.com/mcp` | **OAuth only** | **No** | Figma Support: remote MCP does not accept PATs (`X-Figma-Token` → Unauthorized). |
| sentry | `https://mcp.sentry.dev/mcp` | OAuth **or** `Authorization: Sentry-Bearer <auth token>` | **Yes**, but **not** `Bearer` | Gateway currently sends `Bearer`. Sentry reserves `Bearer` for MCP OAuth; needs a header-scheme change or the token is unused. Org-scoped URL recommended. |
| cloudflare | `https://mcp.cloudflare.com/mcp` | OAuth **or** Cloudflare API token as Bearer | **Yes** — account API token per department | Restrict token permissions per department. |
| pagerduty | `https://mcp.pagerduty.com/mcp` | OAuth **or** REST API key | **Partial** | API keys use `Authorization: Token token=<key>`, not Bearer. OAuth App tokens can be Bearer. Gateway Bearer injection is wrong for API keys until header schemes are per-server. |
| warehouse | Snowflake Cortex MCP (tenant URL) | Snowflake OAuth **or** Programmatic Access Token as Bearer | **Yes** — PAT on a least-privilege role | Replace the template account URL. Snowflake recommends OAuth; PAT is allowed. |
| hubspot | `https://mcp.hubspot.com` | Hosted MCP: **OAuth 2.1 + PKCE**. Local `@hubspot/mcp-server`: private-app token | **Hosted: OAuth.** Private-app Bearer is the **local** server. | Do not assume a private-app token works on `mcp.hubspot.com`. |
| salesforce | `https://api.salesforce.com/platform/mcp/v1/platform/sobject-all` | External Client App, OAuth (`mcp_api`), typically auth-code + PKCE as the **user** | **Not a static PAT.** Client-credentials / JWT bearer may exist for other Salesforce APIs; hosted MCP docs are user OAuth + FLS of that user. | Prefer `sobject-reads` if the department does not need write. |
| zendesk | `https://mcp.zendesk.com/mcp` | Hosted URL unconfirmed. Zendesk REST: API token (being retired) or OAuth | **Unknown for hosted MCP** | Treat as OAuth until `tools/list` succeeds. API tokens sunset 2027-04-30. |
| analytics | `https://mcp.amplitude.com/mcp` | **OAuth 2.0** (product MCP). Claude also documents HTTP Basic (API key + secret) for a connector path | **Maybe Basic**, not documented as Bearer on the hosted MCP | Default docs: OAuth. EU: `mcp.eu.amplitude.com`. |
| vuln-scanner | `https://evo.snyk.io/mcp` | **OAuth** (browser). Agent runs as the Snyk user | **Not documented** for Evo hosted MCP | Snyk API/CLI still have PAT/service accounts; Evo MCP docs describe OAuth only. |
| contract-mgmt | `https://mcp.docusign.com/mcp` | Confidential **Authorization Code Grant** OAuth. Bearer access token accepted once minted | **JWT grant is not supported by hosted MCP** (docs). You can mint a confidential-app access token and send Bearer, then refresh yourself. | Demo host: `mcp-d.docusign.com`. |

## Gateway implication

| Fits current `Authorization: Bearer <MCP_TOKEN_…>` | Needs a different header or OAuth broker |
|---|---|
| GitHub PAT/App token, Cloudflare API token, Snowflake PAT, minted DocuSign access token, Atlassian service key (if enabled), HubSpot **local** private app | Notion hosted, Figma, Slack hosted, Google Drive hosted, Salesforce hosted, Amplitude hosted, Snyk Evo, HubSpot hosted, Sentry (`Sentry-Bearer`), PagerDuty API key (`Token token=`) |

OAuth-only hosted MCP (Notion, Slack, Figma, Drive, Salesforce, HubSpot, Amplitude, Snyk Evo) still needs a service identity, a small REST-backed MCP Worker, or stays off. Do not store `MCP_TOKEN_*` for those until that exists.

Pilot engineering departments (GitHub + Cloudflare static tokens) before those vendors.
