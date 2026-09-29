import { signToken } from '@org/policy-core';
import { Hono } from 'hono';
import { authenticate, canInvoke } from './auth.ts';
import departments from './departments.generated.json';

type Env = { CALLER_KEYS: string } & Record<string, unknown>;
const registry = departments as Record<string, { binding: string; roles: string[] }>;

const app = new Hono<{ Bindings: Env }>();

app.get('/healthz', (c) => c.text('ok'));

// /<department>/<role-slug>/<flue agent path...>  ->  department Worker  /agents/<role-slug>/...
app.all('/:department/:role/*', async (c) => {
  const { department, role } = c.req.param();
  const dept = registry[department];
  if (!dept || !dept.roles.includes(role)) return c.json({ error: 'not found' }, 404);

  const principal = await authenticate(c.req.raw, c.env);
  if (!principal) return c.json({ error: 'unauthorized' }, 401);
  if (!canInvoke(principal, department, role)) return c.json({ error: 'forbidden' }, 403);

  const key = (JSON.parse(c.env.CALLER_KEYS) as Record<string, string>)[department];
  const target = c.env[dept.binding] as { fetch: typeof fetch } | undefined;
  if (!key || !target) return c.json({ error: 'department unavailable' }, 502);

  const token = await signToken({ d: department, r: `role/${role}`, sub: principal.sub, aud: 'caller' }, key, 60);
  const incoming = new URL(c.req.url);
  const rest = incoming.pathname.split('/').slice(3).join('/');
  const url = new URL(`https://department.internal/agents/${role}${rest ? '/' + rest : ''}${incoming.search}`);

  const headers = new Headers(c.req.raw.headers);
  headers.set('authorization', `Bearer ${token}`);
  return target.fetch(new Request(url, { method: c.req.method, headers, body: c.req.raw.body }));
});

export default app;
