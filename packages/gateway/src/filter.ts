/** Filter the `tools` array of a tools/list result, in either a JSON or an SSE (streamable HTTP) body. */

type Msg = { result?: { tools?: { name: string }[] } } & Record<string, unknown>;

function filterMessage(msg: Msg, keep: (tool: string) => boolean): Msg {
  if (msg && msg.result && Array.isArray(msg.result.tools)) {
    return { ...msg, result: { ...msg.result, tools: msg.result.tools.filter((t) => keep(t.name)) } };
  }
  return msg;
}

export function filterToolsListBody(body: string, contentType: string, keep: (tool: string) => boolean): string {
  if (contentType.includes('text/event-stream')) {
    return body
      .split(/\r?\n\r?\n/)
      .map((event) =>
        event
          .split(/\r?\n/)
          .map((line) => {
            if (!line.startsWith('data:')) return line;
            const raw = line.slice(5).trim();
            try {
              return 'data: ' + JSON.stringify(filterMessage(JSON.parse(raw), keep));
            } catch {
              return line;
            }
          })
          .join('\n'),
      )
      .join('\n\n');
  }
  return JSON.stringify(filterMessage(JSON.parse(body), keep));
}
