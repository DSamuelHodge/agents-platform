import { setProvider } from '@flue/runtime';
import { cloudflareBindingProvider } from '@flue/runtime/cloudflare/workers-ai';
import { createAgentRouter } from '@flue/runtime/routing';
import { env } from 'cloudflare:workers';
import { Hono } from 'hono';
import { Lead } from './agents/lead.ts';
import { Teammate } from './agents/teammate.ts';

setProvider(
  cloudflareBindingProvider({
    binding: env.AI,
    gateway: { id: 'dept-sales', metadata: { department: 'sales', probe: 'handoff' } },
  }),
);

const app = new Hono();
app.get('/healthz', (c) => c.text('ok'));
app.route('/agents/lead', createAgentRouter(Lead));
app.route('/agents/teammate', createAgentRouter(Teammate));
export default app;
