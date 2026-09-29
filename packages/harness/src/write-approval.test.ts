import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gateMcpFetch, needsWriteApproval, toolTier, verifyApprovalCode } from './write-approval.ts';

test('write approval is required for legal, security and sales write grants only', () => {
  assert.equal(needsWriteApproval('sales', 'write'), true);
  assert.equal(needsWriteApproval('legal-compliance', 'admin'), true);
  assert.equal(needsWriteApproval('security-compliance', 'write'), true);
  assert.equal(needsWriteApproval('sales', 'read'), false);
  assert.equal(needsWriteApproval('marketing', 'write'), false);
});

test('unclassified tools are admin, so they stay gated', () => {
  assert.equal(toolTier('get_account'), 'read');
  assert.equal(toolTier('create_lead'), 'write');
  assert.equal(toolTier('delete_account'), 'admin');
  assert.equal(toolTier('getJiraIssue'), 'read');
  assert.equal(toolTier('createLead'), 'write');
});

test('approval code compare is length-safe', async () => {
  assert.equal(await verifyApprovalCode('secret-code', 'secret-code'), true);
  assert.equal(await verifyApprovalCode('nope', 'secret-code'), false);
  assert.equal(await verifyApprovalCode('secret-code', undefined), false);
});

test('unapproved fetch blocks write calls and never hits upstream', async () => {
  let hits = 0;
  const inner = (async () => {
    hits += 1;
    return new Response('nope');
  }) as typeof fetch;
  const fetch = gateMcpFetch(inner, { approved: false });
  const res = await fetch('https://mcp-gateway.internal/mcp/salesforce', {
    method: 'POST',
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'create_lead' } }),
  });
  const body = await res.json();
  assert.match(body.error.message, /operator approval/);
  assert.equal(hits, 0);
});

test('unapproved fetch still forwards reads and filters tools/list', async () => {
  const inner = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const msg = JSON.parse(String(init?.body));
    if (msg.method === 'tools/list') {
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'get_account' }, { name: 'create_lead' }] } }),
        { headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true } }), {
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  const fetch = gateMcpFetch(inner, { approved: false });
  const read = await (
    await fetch('https://gw/mcp/x', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_account' } }),
    })
  ).json();
  assert.equal(read.result.ok, true);
  const listed = await (
    await fetch('https://gw/mcp/x', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
  ).json();
  assert.deepEqual(listed.result.tools.map((t: { name: string }) => t.name), ['get_account']);
});

test('approved fetch is a passthrough', async () => {
  const fetch = gateMcpFetch((async () => new Response('ok')) as typeof fetch, { approved: true });
  assert.equal(await (await fetch('https://gw', { method: 'POST', body: '{"method":"tools/call"}' })).text(), 'ok');
});
