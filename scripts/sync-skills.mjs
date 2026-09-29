#!/usr/bin/env node
// Vendors skills from the SEPARATE skills repo into each department, scoped by that repo's manifest and
// the department's policy.json. Flue needs static SKILL.md imports, so skills are bundled at build time.
//   node scripts/sync-skills.mjs --source ../agents-skills            local checkout
//   node scripts/sync-skills.mjs --source git@github.com:org/skills.git --ref <sha-or-tag>
//   node scripts/sync-skills.mjs --verify                              CI: vendored copies match skills.lock.json
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, departments, exists, json, readJson } from './lib.mjs';

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const verify = args.includes('--verify');

function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) throw new Error(`symlink not allowed in skills: ${p}`);
    if (['.git', 'node_modules'].includes(e.name)) return [];
    return e.isDirectory() ? listFiles(p, base) : [path.relative(base, p)];
  }).sort();
}
function hashDir(dir) {
  const h = crypto.createHash('sha256');
  for (const f of listFiles(dir)) { h.update(f + '\0'); h.update(fs.readFileSync(path.join(dir, f))); }
  return h.digest('hex');
}

if (verify) {
  let bad = 0;
  for (const d of departments()) {
    const lockPath = path.join(d.base, 'skills.lock.json');
    if (!exists(lockPath)) { console.error(`${d.slug}: missing skills.lock.json`); bad++; continue; }
    const lock = readJson(lockPath);
    const dir = path.join(d.base, 'src/skills');
    const onDisk = exists(dir) ? fs.readdirSync(dir).sort() : [];
    if (JSON.stringify(onDisk) !== JSON.stringify(Object.keys(lock.skills).sort())) { console.error(`${d.slug}: vendored skill set differs from lock`); bad++; continue; }
    for (const [name, meta] of Object.entries(lock.skills)) {
      if (hashDir(path.join(dir, name)) !== meta.sha256) { console.error(`${d.slug}/${name}: content differs from lock`); bad++; }
    }
  }
  if (bad) process.exit(1);
  console.log('sync-skills: vendored skills match locks');
  process.exit(0);
}

let source = flag('--source') ?? process.env.SKILLS_SOURCE ?? path.resolve(ROOT, '../agents-skills');
const ref = flag('--ref');
let cleanup = null;
if (/^(git@|https?:\/\/|ssh:\/\/)/.test(source) || source.endsWith('.git')) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-'));
  execFileSync('git', ['clone', '--quiet', source, tmp], { stdio: 'inherit' });
  if (ref) execFileSync('git', ['-C', tmp, 'checkout', '--quiet', ref], { stdio: 'inherit' });
  cleanup = tmp; source = tmp;
}
const manifest = readJson(path.join(source, 'skills.manifest.json')).skills;
let commit = 'local';
try { commit = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}

for (const d of departments()) {
  const dest = path.join(d.base, 'src/skills');
  fs.rmSync(dest, { recursive: true, force: true });
  const lock = { source: cleanup ? flag('--source') : 'local checkout', commit, skills: {} };
  for (const name of d.policy.skills) {
    const entry = manifest[name];
    if (!entry) throw new Error(`${d.slug}: policy lists '${name}' but the skills repo has no such skill`);
    if (!entry.departments.includes('*') && !entry.departments.includes(d.slug))
      throw new Error(`${d.slug}: skill '${name}' is not released to this department in skills.manifest.json`);
    const from = path.join(source, entry.path);
    const to = path.join(dest, name);
    fs.mkdirSync(to, { recursive: true });
    for (const f of listFiles(from)) {
      fs.mkdirSync(path.dirname(path.join(to, f)), { recursive: true });
      fs.copyFileSync(path.join(from, f), path.join(to, f));
    }
    lock.skills[name] = { sha256: hashDir(to) };
  }
  fs.writeFileSync(path.join(d.base, 'skills.lock.json'), json(lock));
}
if (cleanup) fs.rmSync(cleanup, { recursive: true, force: true });
console.log(`sync-skills: vendored from ${cleanup ? flag('--source') : source} @ ${commit}`);
