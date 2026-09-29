import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { authenticate, canInvoke, type AccessEnv } from './auth.ts';

const TEAM = 'https://example.cloudflareaccess.com';
const AUD = 'test-audience-tag';

async function signedJwt(privateKey: CryptoKey, claims: Record<string, unknown>) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .setIssuer(TEAM)
    .setAudience(AUD)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
}

async function fixture() {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'test';
  jwk.use = 'sig';
  jwk.alg = 'RS256';
  const env: AccessEnv = {
    TEAM_DOMAIN: TEAM,
    POLICY_AUD: AUD,
    ACCESS_JWKS: JSON.stringify({ keys: [jwk] }),
    ACCESS_EMAIL_GROUPS: JSON.stringify({
      'lead@example.com': ['dept:sales'],
      'admin@example.com': ['admin'],
      'svc-sales': ['role:vp-of-sales'],
    }),
  };
  return { privateKey, env };
}

test('missing Access config fails closed', async () => {
  const req = new Request('https://router/sales/vp-of-sales/run');
  assert.equal(await authenticate(req, {}), null);
});

test('missing assertion fails closed', async () => {
  const { env } = await fixture();
  const req = new Request('https://router/sales/vp-of-sales/run');
  assert.equal(await authenticate(req, env), null);
});

test('valid JWT maps email to department group', async () => {
  const { privateKey, env } = await fixture();
  const jwt = await signedJwt(privateKey, { email: 'lead@example.com', sub: 'user-1' });
  const p = await authenticate(
    new Request('https://router/', { headers: { 'cf-access-jwt-assertion': jwt } }),
    env,
  );
  assert.ok(p);
  assert.equal(p.sub, 'user-1');
  assert.deepEqual(p.groups, ['dept:sales']);
  assert.equal(canInvoke(p, 'sales', 'vp-of-sales'), true);
  assert.equal(canInvoke(p, 'legal-compliance', 'general-counsel'), false);
});

test('admin group can invoke any role', async () => {
  const { privateKey, env } = await fixture();
  const jwt = await signedJwt(privateKey, { email: 'admin@example.com', sub: 'admin-1' });
  const p = await authenticate(
    new Request('https://router/', { headers: { 'cf-access-jwt-assertion': jwt } }),
    env,
  );
  assert.ok(p);
  assert.equal(canInvoke(p, 'legal-compliance', 'general-counsel'), true);
});

test('service token maps common_name', async () => {
  const { privateKey, env } = await fixture();
  const jwt = await signedJwt(privateKey, { common_name: 'svc-sales', sub: '' });
  const p = await authenticate(
    new Request('https://router/', { headers: { 'cf-access-jwt-assertion': jwt } }),
    env,
  );
  assert.ok(p);
  assert.equal(p.sub, 'svc-sales');
  assert.equal(canInvoke(p, 'sales', 'vp-of-sales'), true);
  assert.equal(canInvoke(p, 'sales', 'account-executive'), false);
});

test('garbage JWT is rejected', async () => {
  const { env } = await fixture();
  assert.equal(
    await authenticate(
      new Request('https://router/', { headers: { 'cf-access-jwt-assertion': 'not-a-jwt' } }),
      env,
    ),
    null,
  );
});

test('expired JWT is rejected', async () => {
  const { privateKey, env } = await fixture();
  const jwt = await new SignJWT({ email: 'lead@example.com', sub: 'user-1' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .setIssuer(TEAM)
    .setAudience(AUD)
    .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
    .sign(privateKey);
  assert.equal(
    await authenticate(new Request('https://router/', { headers: { 'cf-access-jwt-assertion': jwt } }), env),
    null,
  );
});

test('unmapped email has no groups and cannot invoke', async () => {
  const { privateKey, env } = await fixture();
  const jwt = await signedJwt(privateKey, { email: 'anyone@hodgederrick.com', sub: 'u2' });
  const p = await authenticate(
    new Request('https://router/', { headers: { 'cf-access-jwt-assertion': jwt } }),
    env,
  );
  assert.ok(p);
  assert.deepEqual(p.groups, []);
  assert.equal(canInvoke(p, 'sales', 'vp-of-sales'), false);
});

test('JWT groups claim cannot grant admin', async () => {
  const { privateKey, env } = await fixture();
  env.ACCESS_EMAIL_GROUPS = '{}';
  const jwt = await signedJwt(privateKey, {
    email: 'spoof@hodgederrick.com',
    sub: 'u3',
    groups: ['admin', 'dept:sales'],
  });
  const p = await authenticate(
    new Request('https://router/', { headers: { 'cf-access-jwt-assertion': jwt } }),
    env,
  );
  assert.ok(p);
  assert.deepEqual(p.groups, ['dept:sales']);
  assert.equal(canInvoke(p, 'legal-compliance', 'general-counsel'), false);
  assert.equal(canInvoke(p, 'sales', 'vp-of-sales'), true);
});

test('wrong audience is rejected', async () => {
  const { privateKey, env } = await fixture();
  const jwt = await new SignJWT({ email: 'lead@example.com', sub: 'user-1' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .setIssuer(TEAM)
    .setAudience('other-aud')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
  assert.equal(
    await authenticate(new Request('https://router/', { headers: { 'cf-access-jwt-assertion': jwt } }), env),
    null,
  );
});

test('IdP groups claim is honoured without the email map', async () => {
  const { privateKey, env } = await fixture();
  env.ACCESS_EMAIL_GROUPS = '{}';
  const jwt = await signedJwt(privateKey, { email: 'anyone@example.com', sub: 'u', groups: ['role:account-executive'] });
  const p = await authenticate(
    new Request('https://router/', { headers: { 'cf-access-jwt-assertion': jwt } }),
    env,
  );
  assert.ok(p);
  assert.equal(canInvoke(p, 'sales', 'account-executive'), true);
});
