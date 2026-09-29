/**
 * Cloudflare Access JWT verification. Fails closed unless TEAM_DOMAIN and POLICY_AUD are set
 * and `Cf-Access-Jwt-Assertion` verifies against the team's JWKS.
 *
 * Group mapping (first match wins, then union):
 * - JWT `groups` claim (string array from the IdP)
 * - ACCESS_EMAIL_GROUPS JSON: { "user@org": ["dept:sales"], "svc-id": ["admin"] }
 *   Service tokens use `common_name` as the lookup key when `sub` is empty.
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JSONWebKeySet, createLocalJWKSet } from 'jose';

export interface Principal {
  sub: string;
  email?: string;
  groups: string[];
}

export interface AccessEnv {
  TEAM_DOMAIN?: string;
  POLICY_AUD?: string;
  ACCESS_EMAIL_GROUPS?: string;
  /** Test-only: inline JWKS so unit tests never hit the network. */
  ACCESS_JWKS?: string;
}

export function canInvoke(p: Principal, department: string, roleSlug: string): boolean {
  return (
    p.groups.includes('admin') || p.groups.includes(`dept:${department}`) || p.groups.includes(`role:${roleSlug}`)
  );
}

const ADMIN = 'admin';

function groupsFromPayload(payload: JWTPayload, env: AccessEnv): string[] {
  const out = new Set<string>();
  const claim = payload.groups;
  if (Array.isArray(claim)) {
    for (const g of claim) {
      // `admin` is never taken from the IdP claim; only ACCESS_EMAIL_GROUPS may grant it.
      if (typeof g === 'string' && g !== ADMIN) out.add(g);
    }
  }
  let map: Record<string, string[]> = {};
  try {
    map = env.ACCESS_EMAIL_GROUPS ? (JSON.parse(env.ACCESS_EMAIL_GROUPS) as Record<string, string[]>) : {};
  } catch {
    map = {};
  }
  const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
  const commonName = typeof payload.common_name === 'string' ? payload.common_name : '';
  const sub = typeof payload.sub === 'string' ? payload.sub : '';
  for (const key of [email, commonName, sub]) {
    const extra = map[key] ?? map[key.toLowerCase()];
    if (extra) for (const g of extra) out.add(g);
  }
  return [...out];
}

export async function authenticate(request: Request, env: AccessEnv): Promise<Principal | null> {
  const team = env.TEAM_DOMAIN?.replace(/\/$/, '');
  const aud = env.POLICY_AUD;
  if (!team || !aud) return null;

  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) return null;

  try {
    const JWKS = env.ACCESS_JWKS
      ? createLocalJWKSet(JSON.parse(env.ACCESS_JWKS) as JSONWebKeySet)
      : createRemoteJWKSet(new URL(`${team}/cdn-cgi/access/certs`));
    const { payload } = await jwtVerify(token, JWKS, { issuer: team, audience: aud });
    const sub =
      (typeof payload.sub === 'string' && payload.sub) ||
      (typeof payload.email === 'string' && payload.email) ||
      (typeof payload.common_name === 'string' && payload.common_name) ||
      '';
    if (!sub) return null;
    return {
      sub,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      groups: groupsFromPayload(payload, env),
    };
  } catch {
    return null;
  }
}
