#!/usr/bin/env node
// Vendors mcp-catalog.json from the separate agents-mcps repo.
//   node scripts/sync-mcp.mjs --source ../agents-mcps
//   node scripts/sync-mcp.mjs --source git@github.com:DSamuelHodge/agents-mcps.git --ref <sha>
//   node scripts/sync-mcp.mjs --verify
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, exists, json, readJson } from './lib.mjs';

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const verify = args.includes('--verify');
const dest = path.join(ROOT, 'mcp-catalog.json');
const lockPath = path.join(ROOT, 'mcp-catalog.lock.json');

function sha(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

if (verify) {
  if (!exists(lockPath) || !exists(dest)) {
    console.error('sync-mcp: missing mcp-catalog.json or mcp-catalog.lock.json');
    process.exit(1);
  }
  const lock = readJson(lockPath);
  if (sha(dest) !== lock.sha256) {
    console.error('sync-mcp: mcp-catalog.json does not match mcp-catalog.lock.json');
    process.exit(1);
  }
  console.log(`sync-mcp: catalog matches lock @ ${lock.commit}`);
  process.exit(0);
}

let source = flag('--source') ?? process.env.MCP_SOURCE ?? path.resolve(ROOT, '../agents-mcps');
const ref = flag('--ref');
let cleanup = null;
if (/^(git@|https?:\/\/|ssh:\/\/)/.test(source) || source.endsWith('.git')) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcps-'));
  execFileSync('git', ['clone', '--quiet', source, tmp], { stdio: 'inherit' });
  if (ref) execFileSync('git', ['-C', tmp, 'checkout', '--quiet', ref], { stdio: 'inherit' });
  cleanup = tmp;
  source = tmp;
}

const from = path.join(source, 'mcp-catalog.json');
if (!exists(from)) {
  console.error(`sync-mcp: no mcp-catalog.json in ${source}`);
  process.exit(1);
}
fs.copyFileSync(from, dest);
let commit = 'local';
try {
  commit = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
} catch {}
fs.writeFileSync(lockPath, json({
  source: cleanup ? flag('--source') : 'local checkout',
  commit,
  file: 'mcp-catalog.json',
  sha256: sha(dest),
}));
if (cleanup) fs.rmSync(cleanup, { recursive: true, force: true });
console.log(`sync-mcp: vendored mcp-catalog.json @ ${commit}`);
