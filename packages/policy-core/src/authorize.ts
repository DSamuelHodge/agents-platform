import type { CatalogServer, PolicyBundle, Tier } from './types.ts';
import { tierRank } from './types.ts';

export const DEFAULT_READ_VERBS = [
  'get',
  'list',
  'search',
  'read',
  'describe',
  'find',
  'fetch',
  'query',
  'view',
  'download',
] as const;
export const DEFAULT_WRITE_VERBS = [
  'create',
  'update',
  'add',
  'copy',
  'comment',
  'post',
  'send',
  'edit',
  'set',
  'upload',
  'append',
  'move',
  'assign',
  'transition',
] as const;

/** Kept for catalog `readPattern` / `writePattern` overrides. Verb + snake, kebab, or camelCase boundary. */
export const DEFAULT_READ = `^(${DEFAULT_READ_VERBS.join('|')})(?:[_-]|[A-Z]|$)`;
export const DEFAULT_WRITE = `^(${DEFAULT_WRITE_VERBS.join('|')})(?:[_-]|[A-Z]|$)`;

/** First path segment of a snake, kebab, or camelCase tool name (`getJiraIssue` → `get`). */
export function toolVerb(tool: string): string {
  const snake = tool.replace(/([a-z\d])([A-Z])/g, '$1_$2').replace(/-/g, '_');
  return (snake.split('_')[0] ?? '').toLowerCase();
}

function verbMatches(tool: string, verbs: readonly string[], pattern?: string): boolean {
  if (pattern) return new RegExp(pattern).test(tool);
  return (verbs as readonly string[]).includes(toolVerb(tool));
}

/** Classify a tool. Unknown verbs are `admin`: new/odd tools are denied until someone classifies them. */
export function tierOf(server: CatalogServer, tool: string): Tier {
  const override = server.overrides?.[tool];
  if (override) return override;
  if (verbMatches(tool, DEFAULT_READ_VERBS, server.readPattern)) return 'read';
  if (verbMatches(tool, DEFAULT_WRITE_VERBS, server.writePattern)) return 'write';
  return 'admin';
}

export type Decision = { allow: true; tier: Tier } | { allow: false; reason: string };

/**
 * Two independent checks must both pass: the department ceiling and the role grant.
 * The department comes from a verified token; the role must belong to that department in the bundle.
 */
export function authorize(
  bundle: PolicyBundle,
  department: string,
  roleLabel: string,
  serverId: string,
  tool: string,
): Decision {
  const catalog = bundle.catalog[serverId];
  if (!catalog) return { allow: false, reason: `unknown server '${serverId}'` };

  const dept = bundle.departments[department];
  if (!dept) return { allow: false, reason: `unknown department '${department}'` };

  const deptGrant = dept.servers[serverId];
  if (!deptGrant) return { allow: false, reason: `server '${serverId}' not allowed for department` };

  const role = dept.roles[roleLabel];
  if (!role) return { allow: false, reason: `role '${roleLabel}' not in department '${department}'` };

  const roleGrant = role.servers[serverId];
  if (!roleGrant) return { allow: false, reason: `server '${serverId}' not granted to role` };

  const tier = tierOf(catalog, tool);
  if (deptGrant.deny?.includes(tool)) return { allow: false, reason: `tool '${tool}' denied for department` };
  if (tierRank(tier) > tierRank(deptGrant.maxTier))
    return { allow: false, reason: `tool tier '${tier}' exceeds department ceiling '${deptGrant.maxTier}'` };
  if (tierRank(tier) > tierRank(roleGrant.tier))
    return { allow: false, reason: `tool tier '${tier}' exceeds role grant '${roleGrant.tier}'` };
  if (roleGrant.tools && !roleGrant.tools.includes(tool))
    return { allow: false, reason: `tool '${tool}' not in role allowlist` };

  return { allow: true, tier };
}
