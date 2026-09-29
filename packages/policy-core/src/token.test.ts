import { test } from 'node:test';
import assert from 'node:assert/strict';
import { peekDepartment, signToken, verifyToken } from './token.ts';

test('round trip, audience, expiry and tamper checks', async () => {
  const now = Date.now();
  const t = await signToken({ d: 'eng', r: 'role/lead', aud: 'mcp' }, 'k1', 60, now);
  assert.equal(peekDepartment(t), 'eng');
  assert.equal((await verifyToken(t, 'k1', 'mcp', now))?.r, 'role/lead');
  assert.equal(await verifyToken(t, 'k2', 'mcp', now), null, 'wrong key');
  assert.equal(await verifyToken(t, 'k1', 'caller', now), null, 'wrong audience');
  assert.equal(await verifyToken(t, 'k1', 'mcp', now + 61_000), null, 'expired');
  const [p, s] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ d: 'legal', r: 'role/x', aud: 'mcp', iat: 0, exp: 9e9 })).toString('base64url');
  assert.equal(await verifyToken(`${forged}.${s}`, 'k1', 'mcp', now), null, 'payload swap');
  assert.equal(await verifyToken(`${p}.${s}.x`, 'k1', 'mcp', now), null, 'extra segment');
});
