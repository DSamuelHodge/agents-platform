#!/usr/bin/env node
// Creates the 20 named AI Gateways (dept-<slug>) if they do not already exist.
// Requires CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID.
import fs from 'node:fs';
import path from 'node:path';
import { departments, ROOT } from './lib.mjs';

const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!account || !token) {
  console.error('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required');
  process.exit(1);
}

const ids = departments().map((d) => d.policy.gatewayId);
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

const listed = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai-gateway/gateways?per_page=50`, {
  headers,
}).then((r) => r.json());
if (!listed.success) {
  console.error(listed);
  process.exit(1);
}
const have = new Set((listed.result ?? []).map((g) => g.id));

for (const id of ids) {
  if (have.has(id)) {
    console.log(`exists ${id}`);
    continue;
  }
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai-gateway/gateways`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      id,
      collect_logs: true,
      cache_ttl: 0,
      cache_invalidate_on_update: false,
      rate_limiting_interval: 0,
      rate_limiting_limit: 0,
      authentication: false,
      workers_ai_billing_mode: 'postpaid',
    }),
  }).then((r) => r.json());
  if (!res.success) {
    console.error(`failed ${id}`, res.errors);
    process.exit(1);
  }
  console.log(`created ${id}`);
}

fs.writeFileSync(
  path.join(ROOT, 'packages/live-probe/gateways.created.json'),
  JSON.stringify({ account, ids, at: new Date().toISOString() }, null, 2),
);
