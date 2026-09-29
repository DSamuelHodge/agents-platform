/**
 * WIRE THIS BEFORE DEPLOYING. It fails closed on purpose.
 *
 * Verify your identity provider's assertion here (for Cloudflare Access: validate the
 * `Cf-Access-Jwt-Assertion` JWT against your team's JWKS and audience) and map the user's IdP groups to
 * `groups`. Recognised groups: `admin`, `dept:<department-slug>`, `role:<role-slug>`.
 */
export interface Principal {
  sub: string;
  groups: string[];
}

export async function authenticate(_request: Request, _env: unknown): Promise<Principal | null> {
  return null; // -> 401 for everyone until implemented
}

export function canInvoke(p: Principal, department: string, roleSlug: string): boolean {
  return (
    p.groups.includes('admin') || p.groups.includes(`dept:${department}`) || p.groups.includes(`role:${roleSlug}`)
  );
}
