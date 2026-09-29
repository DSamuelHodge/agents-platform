import { verifyToken } from '@org/policy-core';
import { env } from 'cloudflare:workers';
import type { MiddlewareHandler } from 'hono';

interface CallerEnv {
  DEPARTMENT: string;
  /** Key shared only between the router and this department. */
  CALLER_KEY: string;
}

/**
 * Mount before the agent routes. Only the router (which holds this department's key) can mint a valid
 * token, and the token must name this department and the role in the URL: `/agents/<role-slug>/...`.
 * Flue does not persist caller headers past admission, so authentication must happen here.
 */
export function requireCaller(): MiddlewareHandler {
  return async (c, next) => {
    const e = env as unknown as CallerEnv;
    const token = (c.req.header('authorization') ?? '').replace(/^Bearer /, '');
    const claims = token ? await verifyToken(token, e.CALLER_KEY, 'caller') : null;
    const slug = c.req.path.split('/')[2];
    if (!claims || claims.d !== e.DEPARTMENT || claims.r !== `role/${slug}`) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    await next();
  };
}
