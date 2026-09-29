import {
  authorize,
  mcpTokenSecretName,
  peekDepartment,
  verifyToken,
  type PolicyBundle,
} from '@org/policy-core';
import { filterToolsListBody } from './filter.ts';
import bundleJson from './policy.generated.json' with { type: 'json' };

const bundle = bundleJson as unknown as PolicyBundle;

interface Env {
  /** JSON map: department slug -> HMAC key. */
  DEPT_KEYS: string;
  [secret: string]: unknown;
}

const PASS_THROUGH = new Set(['initialize', 'ping']);
const FORWARD_HEADERS = ['content-type', 'accept', 'mcp-session-id', 'mcp-protocol-version'];

const rpcError = (id: unknown, code: number, message: string) =>
  new Response(JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code, message } }), {
    headers: { 'content-type': 'application/json' },
  });

function audit(entry: Record<string, unknown>) {
  console.log(JSON.stringify({ type: 'mcp_gateway', ...entry }));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/mcp\/([a-z0-9-]+)$/);
    if (!match) return new Response('not found', { status: 404 });
    const serverId = match[1]!;

    // Streamable HTTP allows servers to refuse the optional GET stream.
    if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });

    // 1. Authenticate: department selects the key; the token proves the department (and claimed role).
    const token = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '');
    const dept = peekDepartment(token);
    let key: string | undefined;
    try {
      key = dept ? (JSON.parse(env.DEPT_KEYS) as Record<string, string>)[dept] : undefined;
    } catch {
      return new Response('gateway misconfigured', { status: 500 });
    }
    const claims = key ? await verifyToken(token, key, 'mcp') : null;
    if (!claims || !claims.r) return new Response('unauthorized', { status: 401 });

    const server = bundle.catalog[serverId];
    const roleGrant = bundle.departments[claims.d]?.roles[claims.r]?.servers[serverId];
    if (!server || !roleGrant) {
      audit({ decision: 'deny', dept: claims.d, role: claims.r, server: serverId, reason: 'server not granted' });
      return new Response('forbidden', { status: 403 });
    }

    // 2. Parse exactly one JSON-RPC message (batches are refused).
    const bodyText = await request.text();
    let msg: { id?: unknown; method?: string; params?: { name?: string } };
    try {
      msg = JSON.parse(bodyText);
    } catch {
      return new Response('bad request', { status: 400 });
    }
    if (Array.isArray(msg) || typeof msg.method !== 'string') return new Response('bad request', { status: 400 });

    const method = msg.method;
    const isNotification = method.startsWith('notifications/');
    const isList = method === 'tools/list';

    // 3. Policy. Default-deny everything except lifecycle, tools/list (filtered) and tools/call (authorized).
    if (method === 'tools/call') {
      const tool = String(msg.params?.name ?? '');
      const decision = authorize(bundle, claims.d, claims.r, serverId, tool);
      audit({ decision: decision.allow ? 'allow' : 'deny', dept: claims.d, role: claims.r, server: serverId, tool,
        ...(decision.allow ? { tier: decision.tier } : { reason: decision.reason }) });
      if (!decision.allow) return rpcError(msg.id, -32001, `denied by policy: ${decision.reason}`);
    } else if (!(isList || isNotification || PASS_THROUGH.has(method))) {
      audit({ decision: 'deny', dept: claims.d, role: claims.r, server: serverId, method });
      return rpcError(msg.id, -32601, `method '${method}' is not available through the gateway`);
    }

    // 4. Forward with the department×server credential. Only the gateway holds it.
    const secretName = mcpTokenSecretName(claims.d, serverId);
    const headers = new Headers();
    for (const h of FORWARD_HEADERS) {
      const v = request.headers.get(h);
      if (v) headers.set(h, v);
    }
    const upstreamToken = env[secretName];
    if (typeof upstreamToken !== 'string' || !upstreamToken) {
      audit({ decision: 'deny', dept: claims.d, role: claims.r, server: serverId, reason: `missing ${secretName}` });
      return rpcError(msg.id, -32003, `gateway has no credential ${secretName}`);
    }
    headers.set('authorization', `Bearer ${upstreamToken}`);

    const upstream = await fetch(server.url, { method: 'POST', headers, body: bodyText });

    if (!isList) return upstream; // stream through untouched

    const keep = (tool: string) => authorize(bundle, claims.d, claims.r!, serverId, tool).allow;
    const filtered = filterToolsListBody(await upstream.text(), upstream.headers.get('content-type') ?? '', keep);
    const out = new Headers(upstream.headers);
    out.delete('content-length');
    return new Response(filtered, { status: upstream.status, headers: out });
  },
};
