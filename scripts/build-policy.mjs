#!/usr/bin/env node
// Compiles department policies + role grants + the MCP catalog into the bundle the gateway enforces.
import path from 'node:path';
import { ROOT, departments, json, makeWriter, readJson } from './lib.mjs';

const check = process.argv.includes('--check');
const out = makeWriter(check);
const catalogFile = readJson(path.join(ROOT, 'mcp-catalog.json'));

const bundle = { version: 1, catalog: catalogFile.servers, departments: {} };
for (const d of departments()) {
  const servers = {};
  for (const [id, g] of Object.entries(d.policy.mcp)) servers[id] = { maxTier: g.maxTier, ...(g.deny?.length ? { deny: g.deny } : {}) };
  const roles = {};
  for (const r of d.roles) {
    roles[r.label] = {
      servers: Object.fromEntries(r.mcp.map((g) => [g.id, { tier: g.tier, ...(g.tools ? { tools: g.tools } : {}) }])),
    };
  }
  bundle.departments[d.slug] = { servers, roles };
}
out.write('packages/gateway/src/policy.generated.json', json(bundle));

if (check && out.diffs.length) { console.error('build-policy: gateway policy bundle is stale; run npm run build-policy'); process.exit(1); }
console.log(check ? 'build-policy: up to date' : 'build-policy: done');
