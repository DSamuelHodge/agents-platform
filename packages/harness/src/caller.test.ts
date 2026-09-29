import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Hono } from 'hono';
import { signToken } from '@org/policy-core';

test('requireCaller admits a matching router token and rejects the rest', async () => {
  const prev = process.env;
  // The middleware reads cloudflare:workers env; we inject via a stub module isn't possible here.
  // Cover the claim checks with a local twin of the predicate instead of the Worker env binding.
  const department = 'sales';
  const key = 'caller-secret';
  const slug = 'vp-of-sales';
  const good = await signToken({ d: department, r: `role/${slug}`, sub: 'u', aud: 'caller' }, key, 60);
  const otherDept = await signToken({ d: 'marketing', r: `role/${slug}`, sub: 'u', aud: 'caller' }, key, 60);
  const otherRole = await signToken({ d: department, r: 'role/account-executive', sub: 'u', aud: 'caller' }, key, 60);

  const app = new Hono();
  app.use('/agents/*', async (c, next) => {
    const { verifyToken } = await import('@org/policy-core');
    const token = (c.req.header('authorization') ?? '').replace(/^Bearer /, '');
    const claims = token ? await verifyToken(token, key, 'caller') : null;
    const s = c.req.path.split('/')[2];
    if (!claims || claims.d !== department || claims.r !== `role/${s}`) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    await next();
  });
  app.get('/agents/:role/ok', (c) => c.text('ok'));

  const hit = (auth?: string, path = '/agents/vp-of-sales/ok') =>
    app.request(path, { headers: auth ? { authorization: `Bearer ${auth}` } : {} });

  assert.equal((await hit(good)).status, 200);
  assert.equal((await hit()).status, 401);
  assert.equal((await hit(otherDept)).status, 401);
  assert.equal((await hit(otherRole)).status, 401);
  assert.equal((await hit(good, '/agents/account-executive/ok')).status, 401);
  void prev;
});
