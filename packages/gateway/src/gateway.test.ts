import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { signToken } from '@org/policy-core';
import gateway from './index.ts';

const KEYS = { sales: 'k-sales', 'legal-compliance': 'k-legal', 'devops-infrastructure': 'k-devops' };
const env = {
  DEPT_KEYS: JSON.stringify(KEYS),
  MCP_TOKEN_SALES_SALESFORCE: 'sales-secret',
  MCP_TOKEN_LEGAL_COMPLIANCE_CONTRACT_MGMT: 'legal-secret',
  MCP_TOKEN_DEVOPS_INFRASTRUCTURE_SENTRY: 'sentry-secret',
  MCP_TOKEN_DEVOPS_INFRASTRUCTURE_PAGERDUTY: 'pd-secret',
  MCP_TOKEN_DEVOPS_INFRASTRUCTURE_GITHUB: 'gh-secret',
};
const TOOLS = ['get_account', 'list_leads', 'create_lead', 'delete_account'];

let upstreamCalls: { auth: string | null; body: any }[] = [];
beforeEach(() => {
  upstreamCalls = [];
  globalThis.fetch = (async (_url: any, init: any) => {
    const body = JSON.parse(init.body);
    upstreamCalls.push({ auth: new Headers(init.headers).get('authorization'), body });
    const result = body.method === 'tools/list' ? { tools: TOOLS.map((name) => ({ name })) } : { ok: true };
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
});

async function call(dept: keyof typeof KEYS, role: string, server: string, rpc: object, key = KEYS[dept]) {
  const token = await signToken({ d: dept, r: role, aud: 'mcp' }, key, 60);
  const req = new Request(`https://gw/mcp/${server}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(rpc),
  });
  return gateway.fetch(req, env);
}
const rpc = (method: string, params?: object) => ({ jsonrpc: '2.0', id: 1, method, params });

test('Sentry-Bearer and PagerDuty Token schemes are applied per catalog server', async () => {
  const sentry = await call(
    'devops-infrastructure',
    'role/devops-manager',
    'sentry',
    rpc('tools/call', { name: 'get_issue' }),
  );
  assert.equal(sentry.status, 200);
  assert.equal(upstreamCalls[0]!.auth, 'Sentry-Bearer sentry-secret');
  const pd = await call(
    'devops-infrastructure',
    'role/devops-manager',
    'pagerduty',
    rpc('tools/call', { name: 'get_incident' }),
  );
  assert.equal(pd.status, 200);
  assert.equal(upstreamCalls[1]!.auth, 'Token token=pd-secret');
});

test('lead can call write-tier tools; upstream sees only the gateway-held credential', async () => {
  const res = await call('sales', 'role/vp-of-sales', 'salesforce', rpc('tools/call', { name: 'create_lead' }));
  assert.equal((await res.json()).result.ok, true);
  assert.equal(upstreamCalls[0]!.auth, 'Bearer sales-secret');
});

test('missing department×server secret does not fall back to a shared token', async () => {
  const thin = { DEPT_KEYS: JSON.stringify(KEYS), MCP_TOKEN_SALESFORCE: 'shared-must-not-be-used' };
  const token = await signToken({ d: 'sales', r: 'role/vp-of-sales', aud: 'mcp' }, KEYS.sales, 60);
  const res = await gateway.fetch(
    new Request('https://gw/mcp/salesforce', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(rpc('tools/call', { name: 'get_account' })),
    }),
    thin,
  );
  const body = await res.json();
  assert.match(body.error.message, /MCP_TOKEN_SALES_SALESFORCE/);
  assert.equal(upstreamCalls.length, 0);
});

test('read-only role is denied writes and never reaches upstream', async () => {
  const res = await call('sales', 'role/sales-development-rep-sdr', 'salesforce', rpc('tools/call', { name: 'create_lead' }));
  assert.match((await res.json()).error.message, /exceeds role grant/);
  assert.equal(upstreamCalls.length, 0);
});

test('admin-tier (unclassified/destructive) tools are denied even for the lead', async () => {
  const res = await call('sales', 'role/vp-of-sales', 'salesforce', rpc('tools/call', { name: 'delete_account' }));
  assert.match((await res.json()).error.message, /exceeds department ceiling/);
  assert.equal(upstreamCalls.length, 0);
});

test('tools/list is filtered per role', async () => {
  const lead = await (await call('sales', 'role/vp-of-sales', 'salesforce', rpc('tools/list'))).json();
  assert.deepEqual(lead.result.tools.map((t: any) => t.name), ['get_account', 'list_leads', 'create_lead']);
  const sdr = await (await call('sales', 'role/sales-development-rep-sdr', 'salesforce', rpc('tools/list'))).json();
  assert.deepEqual(sdr.result.tools.map((t: any) => t.name), ['get_account', 'list_leads']);
});

test('a department cannot reach servers outside its allowed list', async () => {
  const res = await call('legal-compliance', 'role/general-counsel', 'salesforce', rpc('tools/call', { name: 'get_account' }));
  assert.equal(res.status, 403);
  assert.equal(upstreamCalls.length, 0);
});

test('a role claimed under the wrong department is rejected', async () => {
  const res = await call('legal-compliance', 'role/vp-of-sales', 'contract-mgmt', rpc('tools/call', { name: 'get_contract' }));
  assert.equal(res.status, 403);
});

test('forging another department with your own key fails authentication', async () => {
  const token = await signToken({ d: 'sales', r: 'role/vp-of-sales', aud: 'mcp' }, KEYS['legal-compliance'], 60);
  const res = await gateway.fetch(new Request('https://gw/mcp/salesforce', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(rpc('tools/list')) }), env);
  assert.equal(res.status, 401);
});

test('no token, GET, and unsupported methods are refused', async () => {
  assert.equal((await gateway.fetch(new Request('https://gw/mcp/salesforce', { method: 'POST', body: '{}' }), env)).status, 401);
  assert.equal((await gateway.fetch(new Request('https://gw/mcp/salesforce'), env)).status, 405);
  const res = await call('sales', 'role/vp-of-sales', 'salesforce', rpc('resources/read', { uri: 'x' }));
  assert.match((await res.json()).error.message, /not available through the gateway/);
  assert.equal(upstreamCalls.length, 0);
});
