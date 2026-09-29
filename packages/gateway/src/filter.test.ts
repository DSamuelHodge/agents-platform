import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterToolsListBody } from './filter.ts';

const keep = (t: string) => t.startsWith('get_');
const payload = { jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'get_a' }, { name: 'delete_b' }], nextCursor: 'c' } };

test('filters JSON bodies and preserves other fields', () => {
  const out = JSON.parse(filterToolsListBody(JSON.stringify(payload), 'application/json', keep));
  assert.deepEqual(out.result.tools, [{ name: 'get_a' }]);
  assert.equal(out.result.nextCursor, 'c');
});

test('filters SSE bodies', () => {
  const sse = `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
  const out = filterToolsListBody(sse, 'text/event-stream', keep);
  const line = out.split('\n').find((l) => l.startsWith('data:'))!;
  assert.deepEqual(JSON.parse(line.slice(5)).result.tools, [{ name: 'get_a' }]);
});

test('non-list messages pass through untouched', () => {
  const m = { jsonrpc: '2.0', id: 2, result: { ok: true } };
  assert.deepEqual(JSON.parse(filterToolsListBody(JSON.stringify(m), 'application/json', keep)), m);
});
