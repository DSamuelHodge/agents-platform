import { defineTool, init, useTool, type Agent } from '@flue/runtime';
import * as v from 'valibot';

export interface TeamMember {
  agent: Agent;
  name: string;
}

/**
 * Lets a department lead hand a self-contained task to a teammate and wait for the reply.
 *
 * Why not Flue subagents? A delegate's frame cannot hold MCP connections, so it would run without the
 * teammate's scoped tools. Dispatching to the teammate's own agent instance keeps each role inside its
 * own least-privilege grant. Processing is at-least-once, so teammates' side effects must be idempotent.
 */
export function useHandoff(team: Record<string, TeamMember>) {
  const slugs = Object.keys(team);
  if (slugs.length === 0) return;

  useTool(
    defineTool({
      name: 'handoff',
      description:
        'Hand a complete, self-contained task to a teammate in your department and wait for their reply. ' +
        'The teammate sees only the task text, so include all context. Teammates: ' +
        slugs.map((s) => `${s} (${team[s]!.name})`).join(', ') +
        '.',
      input: v.object({
        role: v.picklist(slugs as [string, ...string[]]),
        task: v.string(),
        threadId: v.optional(v.string()),
      }),
      async run({ data }) {
        const member = team[data.role]!;
        const handle = init(member.agent, { id: data.threadId ?? `handoff-${crypto.randomUUID()}` });
        const receipt = await handle.dispatch(data.task);
        const reply = await handle.read(receipt);
        return { output: { role: data.role, reply: reply.text } };
      },
    }),
  );
}
