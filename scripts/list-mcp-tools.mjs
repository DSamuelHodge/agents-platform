#!/usr/bin/env node
// POST tools/list to each catalog server and draft mcp-catalog overrides for unclassified tools.
//   node scripts/list-mcp-tools.mjs
//   node scripts/list-mcp-tools.mjs --apply --reviewed   merge draft overrides (admin placeholders only) after a human read the draft
//
// Auth: env MCP_TOKEN_<DEPT>_<SERVER> (preferred) or MCP_TOKEN_<SERVER>. Treat 401/403/405 as "host exists, list unconfirmed".
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, departments, json, mcpTokenSecretName, readJson, upperSnake, upstreamAuthHeader } from './lib.mjs';

const READ = new Set(['get', 'list', 'search', 'read', 'describe', 'find', 'fetch', 'query', 'view', 'download']);
const WRITE = new Set(['create', 'update', 'add', 'copy', 'comment', 'post', 'send', 'edit', 'set', 'upload', 'append', 'move', 'assign', 'transition']);
const toolVerb = (tool) =>
  tool.replace(/([a-z\d])([A-Z])/g, '$1_$2').replace(/-/g, '_').split('_')[0].toLowerCase();
function classify(server, tool) {
  if (server.overrides?.[tool]) return server.overrides[tool];
  const v = toolVerb(tool);
  if (READ.has(v)) return 'read';
  if (WRITE.has(v)) return 'write';
  return 'admin';
}

const apply = process.argv.includes('--apply');
const reviewed = process.argv.includes('--reviewed');
if (apply && !reviewed) {
  console.error('list-mcp-tools: --apply requires --reviewed (read mcp-catalog.overrides.draft.json first)');
  process.exit(1);
}
const catalogPath = path.join(ROOT, 'mcp-catalog.json');
const catalog = readJson(catalogPath);
const outPath = path.join(ROOT, 'mcp-catalog.overrides.draft.json');

const depts = departments();
const serversUsing = {};
for (const d of depts) {
  for (const id of Object.keys(d.policy.mcp ?? {})) {
    (serversUsing[id] ??= []).push(d.slug);
  }
}

function tokenFor(serverId) {
  const deptsFor = serversUsing[serverId] ?? depts.map((d) => d.slug);
  for (const slug of deptsFor) {
    const name = mcpTokenSecretName(slug, serverId);
    if (process.env[name]) return { name, value: process.env[name] };
  }
  const shared = `MCP_TOKEN_${upperSnake(serverId)}`;
  if (process.env[shared]) return { name: shared, value: process.env[shared], shared: true };
  return null;
}

async function listTools(url, token, server) {
  const headers = { 'content-type': 'application/json', accept: 'application/json' };
  if (token) {
    const cred = upstreamAuthHeader(server, token);
    headers[cred.name.toLowerCase()] = cred.value;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 400);
  }
  return { status: res.status, body };
}

const report = { at: new Date().toISOString(), servers: {} };

for (const [id, server] of Object.entries(catalog.servers ?? {})) {
  const auth = tokenFor(id);
  let status;
  let tools = [];
  let error;
  try {
    const listed = await listTools(server.url, auth?.value, server);
    status = listed.status;
    const names = listed.body?.result?.tools?.map((t) => t.name).filter(Boolean);
    if (Array.isArray(names)) tools = names;
    else error = { http: listed.status, body: listed.body };
  } catch (e) {
    error = { message: String(e) };
  }

  const draftOverrides = { ...(server.overrides ?? {}) };
  const unclassified = [];
  for (const name of tools) {
    const tier = classify(server, name);
    if (tier === 'admin' && draftOverrides[name] === undefined) {
      unclassified.push({ name, verb: toolVerb(name) });
      draftOverrides[name] = 'admin';
    }
  }

  const confirmed = tools.length > 0;
  report.servers[id] = {
    url: server.url,
    confirmed,
    httpStatus: status,
    auth: auth ? { secret: auth.name, shared: !!auth.shared } : null,
    toolCount: tools.length,
    tools,
    unclassified,
    draftOverrides: confirmed ? draftOverrides : server.overrides ?? {},
    error: error ?? null,
  };
}

fs.writeFileSync(outPath, json(report));
console.log(`wrote ${path.relative(ROOT, outPath)}`);

if (apply) {
  for (const [id, entry] of Object.entries(report.servers)) {
    if (!entry.confirmed) continue;
    catalog.servers[id].overrides = entry.draftOverrides;
  }
  fs.writeFileSync(catalogPath, json(catalog));
  console.log('merged confirmed draftOverrides into mcp-catalog.json (admin placeholders only; reclassify before relying on them)');
}

const unconfirmed = Object.entries(report.servers).filter(([, s]) => !s.confirmed).map(([id]) => id);
if (unconfirmed.length) console.log(`unconfirmed (no tools/list): ${unconfirmed.join(', ')}`);
