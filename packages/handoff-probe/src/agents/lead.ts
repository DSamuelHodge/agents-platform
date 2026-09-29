'use agent';
import { Teammate } from './teammate.ts';
import { useHandoff } from '@org/harness';
import { useModel } from '@flue/runtime';

export function Lead() {
  useModel('cloudflare/@cf/moonshotai/kimi-k2.6');
  useHandoff({ teammate: { agent: Teammate, name: 'Teammate' } });
  return 'You are the probe lead. Always hand the user message to role `teammate` via the handoff tool. Then return only the teammate reply.';
}
