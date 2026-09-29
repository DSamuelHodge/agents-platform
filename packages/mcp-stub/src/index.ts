/** Streamable-HTTP MCP stub used for live gateway tests. */
const TOOLS = [{ name: 'get_account' }, { name: 'list_leads' }, { name: 'create_lead' }];

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
    const msg = (await request.json()) as { id?: unknown; method?: string; params?: { name?: string } };
    if (msg.method === 'tools/list') {
      return Response.json({ jsonrpc: '2.0', id: msg.id ?? null, result: { tools: TOOLS } });
    }
    if (msg.method === 'tools/call') {
      return Response.json({
        jsonrpc: '2.0',
        id: msg.id ?? null,
        result: { content: [{ type: 'text', text: `stub:${msg.params?.name}` }] },
      });
    }
    if (msg.method === 'initialize' || msg.method === 'ping') {
      return Response.json({ jsonrpc: '2.0', id: msg.id ?? null, result: {} });
    }
    return Response.json({ jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32601, message: 'unknown' } });
  },
};
