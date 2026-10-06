import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
export const exists = (p) => fs.existsSync(p);
export const pascal = (slug) => slug.split('-').map((p) => p[0].toUpperCase() + p.slice(1)).join('');
export const upperSnake = (s) => s.toUpperCase().replace(/-/g, '_');
export const mcpTokenSecretName = (department, serverId) =>
  `MCP_TOKEN_${upperSnake(department)}_${upperSnake(serverId)}`;

/** Committed list of gateway secret *names* (never values). Role JSON stays complete. */
export const PRESENT_TOKENS_FILE = 'mcp-tokens.present.json';

/** KEY=VALUE lines; quoted values unwrapped. Does not expand ${} or export. */
export function parseDotEnv(text) {
  const out = {};
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i <= 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
      (v.startsWith("'") && v.endsWith("'") && v.length >= 2)
    ) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

/**
 * MCP_TOKEN_* names that have a non-empty value in env / .env, else the committed inventory.
 * Values are never returned.
 */
export function collectPresentMcpTokenNames({ env = process.env, envFileText = null, present = [] } = {}) {
  const fromLive = [];
  const take = (obj) => {
    for (const [k, v] of Object.entries(obj ?? {})) {
      if (k.startsWith('MCP_TOKEN_') && typeof v === 'string' && v.trim()) fromLive.push(k);
    }
  };
  take(env);
  if (envFileText) take(parseDotEnv(envFileText));
  const names = fromLive.length
    ? fromLive
    : (present ?? []).filter((n) => typeof n === 'string' && n.startsWith('MCP_TOKEN_'));
  return [...new Set(names)].sort();
}

/** Role grants whose gateway secret is present. Unmounted servers stay in the role JSON. */
export function mountedMcpGrants(department, grants, presentNames) {
  const set = new Set(presentNames);
  return (grants ?? []).filter((g) => set.has(mcpTokenSecretName(department, g.id)));
}

export function upstreamAuthHeader(server, credential) {
  const name = server.auth?.header ?? 'Authorization';
  const scheme = server.auth?.scheme ?? 'Bearer';
  const value = /[=:]$/.test(scheme) ? `${scheme}${credential}` : `${scheme} ${credential}`;
  return { name, value };
}

/** "10.2" sorts after "9.7". */
const idKey = (id) => id.split('.').map(Number);
export const byRoleId = (a, b) => {
  const [a1, a2] = idKey(a.roleId), [b1, b2] = idKey(b.roleId);
  return a1 - b1 || a2 - b2;
};

export function departments() {
  const dir = path.join(ROOT, 'departments');
  return fs.readdirSync(dir).filter((d) => exists(path.join(dir, d, 'policy.json'))).sort().map((slug) => {
    const base = path.join(dir, slug);
    const policy = readJson(path.join(base, 'policy.json'));
    const rolesDir = path.join(base, 'roles');
    const roles = fs.readdirSync(rolesDir).filter((f) => f.endsWith('.json')).map((f) => ({
      slug: f.replace(/\.json$/, ''),
      ...readJson(path.join(rolesDir, f)),
    })).sort(byRoleId);
    return { slug, base, policy, roles };
  });
}

/** Collects expected file contents; in --check mode compares to disk instead of writing. */
export function makeWriter(check) {
  const diffs = [];
  return {
    diffs,
    write(file, content) {
      const abs = path.join(ROOT, file);
      const cur = exists(abs) ? fs.readFileSync(abs, 'utf8') : null;
      if (cur === content) return;
      if (check) { diffs.push(file); return; }
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    },
  };
}
export const json = (o) => JSON.stringify(o, null, 2) + '\n';
