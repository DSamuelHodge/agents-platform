#!/usr/bin/env node
// Fails the build when any role exceeds its department's allowed list, or the inventory drifts from the map.
import path from 'node:path';
import { ROOT, departments, exists, readJson } from './lib.mjs';

const TIER = { read: 0, write: 1, admin: 2 };
const errors = [];
const err = (m) => errors.push(m);

const map = readJson(path.join(ROOT, 'role-label-map.source.json'));
const catalogFile = readJson(path.join(ROOT, 'mcp-catalog.json'));
const catalog = catalogFile.servers;
for (const [id, s] of Object.entries(catalog ?? {})) {
  if (s.auth) {
    if (s.auth.header != null && typeof s.auth.header !== 'string') err(`catalog ${id}: auth.header must be a string`);
    if (s.auth.scheme != null && typeof s.auth.scheme !== 'string') err(`catalog ${id}: auth.scheme must be a string`);
  }
}
const depts = departments();

// 1. inventory matches the map exactly
const mapDepts = new Set(Object.values(map).map((r) => r.file.split('/')[1]));
if (mapDepts.size !== depts.length) err(`map has ${mapDepts.size} departments, repo has ${depts.length}`);
const seen = new Set();
for (const d of depts) for (const r of d.roles) seen.add(r.label);
for (const label of Object.keys(map)) if (!seen.has(label)) err(`map role missing from repo: ${label}`);
for (const label of seen) if (!map[label]) err(`repo role not in map: ${label}`);

for (const d of depts) {
  const p = d.policy;
  if (p.department !== d.slug) err(`${d.slug}: policy.department mismatch`);
  if (!mapDepts.has(d.slug)) err(`${d.slug}: department not in map`);
  if (d.roles.filter((r) => r.lead).length !== 1) err(`${d.slug}: must have exactly one lead role`);
  for (const [id, g] of Object.entries(p.mcp)) {
    if (!catalog[id]) err(`${d.slug}: policy references unknown MCP server '${id}'`);
    if (!(g.maxTier in TIER)) err(`${d.slug}: bad maxTier for ${id}`);
  }
  for (const m of p.models.allowed) if (!m.includes('/')) err(`${d.slug}: bad model specifier '${m}'`);
  if (!p.models.allowed.includes(p.models.default)) err(`${d.slug}: default model not in allowed list`);
  if (!p.gatewayId) err(`${d.slug}: missing gatewayId`);

  const slugs = new Set(d.roles.map((r) => r.slug));
  for (const r of d.roles) {
    const where = `${d.slug}/${r.slug}`;
    const m = map[r.label];
    if (m) {
      if (m.roleId !== r.roleId) err(`${where}: roleId ${r.roleId} != map ${m.roleId}`);
      if (m.name !== r.name) err(`${where}: name differs from map`);
      if (m.file.split('/')[1] !== d.slug) err(`${where}: department differs from map`);
    }
    if (r.department !== d.slug) err(`${where}: manifest.department mismatch`);
    if (r.label !== `role/${r.slug}`) err(`${where}: label/filename mismatch`);
    if (!p.models.allowed.includes(r.model)) err(`${where}: model '${r.model}' not allowed for department`);
    for (const s of r.skills) {
      if (!p.skills.includes(s)) err(`${where}: skill '${s}' not on department allowed list`);
      if (!exists(path.join(d.base, 'src/skills', s, 'SKILL.md'))) err(`${where}: skill '${s}' not vendored (run npm run sync-skills)`);
    }
    const ids = new Set();
    for (const g of r.mcp) {
      if (ids.has(g.id)) err(`${where}: duplicate MCP grant '${g.id}'`);
      ids.add(g.id);
      const ceiling = p.mcp[g.id];
      if (!ceiling) { err(`${where}: MCP server '${g.id}' not on department allowed list`); continue; }
      if (TIER[g.tier] > TIER[ceiling.maxTier]) err(`${where}: '${g.id}' tier '${g.tier}' exceeds department ceiling '${ceiling.maxTier}'`);
      for (const t of g.tools ?? []) if (ceiling.deny?.includes(t)) err(`${where}: tool '${t}' is denied by department policy`);
    }
    if (r.delegatesTo) {
      if (!r.lead) err(`${where}: only the lead may delegate`);
      for (const s of r.delegatesTo) {
        if (!slugs.has(s)) err(`${where}: delegatesTo '${s}' is not a role in this department`);
        if (s === r.slug) err(`${where}: cannot delegate to itself`);
      }
    }
  }
}

const ADMIN_EMAILS = new Set(['dshodge2020@outlook.com', 'hodgedomain@gmail.com']);
const deptSlugs = new Set(depts.map((d) => d.slug));
const roleSlugs = new Set(depts.flatMap((d) => d.roles.map((r) => r.slug)));
const groupsPath = path.join(ROOT, 'access-email-groups.json');
if (exists(groupsPath)) {
  const groups = readJson(groupsPath);
  for (const [email, gs] of Object.entries(groups)) {
    if (!Array.isArray(gs)) {
      err(`access-email-groups: '${email}' must map to an array`);
      continue;
    }
    for (const g of gs) {
      if (g === 'admin') {
        if (!ADMIN_EMAILS.has(email.toLowerCase())) err(`access-email-groups: only ${[...ADMIN_EMAILS].join(', ')} may be admin (got '${email}')`);
      } else if (g.startsWith('dept:')) {
        const slug = g.slice(5);
        if (!deptSlugs.has(slug)) err(`access-email-groups: unknown department '${slug}' for ${email}`);
      } else if (g.startsWith('role:')) {
        const slug = g.slice(5);
        if (!roleSlugs.has(slug)) err(`access-email-groups: unknown role '${slug}' for ${email}`);
      } else err(`access-email-groups: ${email} has unknown group '${g}'`);
    }
  }
}

if (errors.length) {
  console.error(`validate: ${errors.length} problem(s)`);
  for (const e of errors.slice(0, 40)) console.error('  - ' + e);
  process.exit(1);
}
console.log(`validate: ok (${depts.length} departments, ${seen.size} roles)`);
