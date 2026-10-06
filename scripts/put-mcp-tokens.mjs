#!/usr/bin/env node
// Put MCP_TOKEN_<DEPT>_<SERVER> Worker secrets on agents-mcp-gateway from env.
//   MCP_TOKEN_BACKEND_DEVELOPMENT_GITHUB=ghp_... node scripts/put-mcp-tokens.mjs
//   DRY_RUN=1 to print names only.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, PRESENT_TOKENS_FILE, departments, exists, json, mcpTokenSecretName, readJson } from './lib.mjs';

const dry = process.env.DRY_RUN === '1';
const servers = (process.argv.slice(2).filter((a) => !a.startsWith('-'))[0] ?? 'github,cloudflare')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const names = [];
for (const d of departments()) {
  for (const id of servers) {
    if (!d.policy.mcp?.[id]) continue;
    names.push(mcpTokenSecretName(d.slug, id));
  }
}

let missing = 0;
for (const name of names) {
  const value = process.env[name];
  if (dry) {
    console.log(`[dry-run] ${name} -> agents-mcp-gateway${value ? '' : ' (env unset)'}`);
    continue;
  }
  if (!value) {
    console.error(`missing env ${name}`);
    missing++;
    continue;
  }
  const r = spawnSync('npx', ['wrangler', 'secret', 'put', name, '--name', 'agents-mcp-gateway'], {
    input: value,
    encoding: 'utf8',
    shell: true,
  });
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    process.exit(r.status ?? 1);
  }
  console.log(`set ${name} on agents-mcp-gateway`);
}
if (missing) process.exit(1);
if (!names.length) console.log('no department policies reference', servers.join(', '));
else if (!dry) {
  const p = path.join(ROOT, PRESENT_TOKENS_FILE);
  const prev = exists(p) ? readJson(p) : { secrets: [] };
  const secrets = [...new Set([...(prev.secrets ?? []), ...names.filter((n) => process.env[n])])].sort();
  fs.writeFileSync(p, json({
    _comment:
      'Gateway MCP_TOKEN_* names that exist. Role JSON stays complete; generate mounts only these. Values live in .env and Worker secrets, never here.',
    secrets,
  }));
}
