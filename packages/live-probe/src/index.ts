/**
 * Public probe Worker used to verify Workers AI (via named AI Gateway), a stub MCP
 * round-trip through the private gateway, and a same-isolate handoff (dispatch + read).
 */
import { signToken } from '@org/policy-core';

interface Env {
  AI: {
    run: (model: string, input: unknown, opts?: { gateway?: { id: string; metadata?: Record<string, string> } }) => Promise<unknown>;
  };
  MCP_GATEWAY?: { fetch: typeof fetch };
  DEPT_KEY?: string;
}

async function probeAi(env: Env) {
  const result = await env.AI.run(
    '@cf/moonshotai/kimi-k2.6',
    { messages: [{ role: 'user', content: 'Reply with the single word pong.' }] },
    { gateway: { id: 'dept-sales', metadata: { department: 'sales', probe: 'live' } } },
  );
  return { ok: true, result };
}

async function probeMcp(env: Env) {
  if (!env.MCP_GATEWAY || !env.DEPT_KEY) return { ok: false, error: 'MCP_GATEWAY or DEPT_KEY missing' };
  const token = await signToken({ d: 'sales', r: 'role/vp-of-sales', aud: 'mcp' }, env.DEPT_KEY, 60);
  const res = await env.MCP_GATEWAY.fetch(
    new Request('https://mcp-gateway.internal/mcp/salesforce', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    }),
  );
  return { ok: res.ok, status: res.status, body: await res.text() };
}

/** Same-isolate stand-in for Flue dispatch/read: a Durable Object is overkill; this proves the probe Worker runs. */
async function probeHandoff() {
  const teammate = async (task: string) => `ack:${task}`;
  const reply = await teammate('qualify ACME');
  return { ok: reply === 'ack:qualify ACME', reply };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    try {
      if (path === '/ai') return Response.json(await probeAi(env));
      if (path === '/mcp') return Response.json(await probeMcp(env));
      if (path === '/handoff') return Response.json(await probeHandoff());
      if (path === '/healthz') return new Response('ok');
      return new Response('not found', { status: 404 });
    } catch (err) {
      return Response.json({ ok: false, error: String(err) }, { status: 500 });
    }
  },
};
