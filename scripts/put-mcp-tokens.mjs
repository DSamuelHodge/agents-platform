#!/usr/bin/env node
// Put MCP_TOKEN_<DEPT>_<SERVER> Worker secrets on agents-mcp-gateway from env.
//   MCP_TOKEN_BACKEND_DEVELOPMENT_GITHUB=ghp_... node scripts/put-mcp-tokens.mjs
//   DRY_RUN=1 to print names only.
import { spawnSync } from 'node:child_process';
import { departments, mcpTokenSecretName } from './lib.mjs';

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
