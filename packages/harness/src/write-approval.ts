import { DEFAULT_READ, DEFAULT_WRITE, type CatalogServer, type Tier, tierOf } from '@org/policy-core';

/** Departments whose write-tier MCP calls require a human approval code first. */
export const WRITE_APPROVAL_DEPARTMENTS = new Set(['legal-compliance', 'security-compliance', 'sales']);

const fallbackServer: CatalogServer = {
  url: 'https://unused.invalid',
  readPattern: DEFAULT_READ,
  writePattern: DEFAULT_WRITE,
};

export function needsWriteApproval(department: string, grantTier: Tier): boolean {
  return WRITE_APPROVAL_DEPARTMENTS.has(department) && grantTier !== 'read';
}

export function toolTier(tool: string, server?: CatalogServer): Tier {
  return tierOf(server ?? fallbackServer, tool);
}

const enc = new TextEncoder();

function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  const n = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < n; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/** Timing-safe compare of the operator code against the Worker secret. */
export async function verifyApprovalCode(code: string, expected: string | undefined): Promise<boolean> {
  if (!expected || !code) return false;
  return timingSafeEqualBytes(enc.encode(code), enc.encode(expected));
}

function rpcError(id: unknown, message: string): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code: -32010, message } }), {
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Until the session is approved, write/admin `tools/call` never leave the Worker, and `tools/list`
 * is filtered to read-tier names. Read calls still go to the gateway (which re-checks policy).
 */
export function gateMcpFetch(
  inner: typeof fetch,
  opts: { approved: boolean; catalog?: CatalogServer },
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (opts.approved) return inner(input, init);
    const bodyText = typeof init?.body === 'string' ? init.body : init?.body ? await new Request('https://x', init).text() : '';
    let msg: { id?: unknown; method?: string; params?: { name?: string }; result?: { tools?: { name: string }[] } };
    try {
      msg = JSON.parse(bodyText || '{}');
    } catch {
      return inner(input, init);
    }
    if (msg.method === 'tools/call') {
      const tool = String(msg.params?.name ?? '');
      if (toolTier(tool, opts.catalog) !== 'read') {
        return rpcError(msg.id, `write requires operator approval before calling '${tool}'`);
      }
    }
    const res = await inner(input, init);
    if (msg.method !== 'tools/list') return res;
    const text = await res.text();
    try {
      const listed = JSON.parse(text) as { result?: { tools?: { name: string }[] } };
      if (listed.result?.tools) {
        listed.result.tools = listed.result.tools.filter((t) => toolTier(t.name, opts.catalog) === 'read');
      }
      const headers = new Headers(res.headers);
      headers.delete('content-length');
      return new Response(JSON.stringify(listed), { status: res.status, headers });
    } catch {
      return new Response(text, { status: res.status, headers: res.headers });
    }
  }) as typeof fetch;
}
