import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
export const exists = (p) => fs.existsSync(p);
export const pascal = (slug) => slug.split('-').map((p) => p[0].toUpperCase() + p.slice(1)).join('');
export const upperSnake = (s) => s.toUpperCase().replace(/-/g, '_');

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
