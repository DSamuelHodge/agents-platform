'use agent';
import { useModel } from '@flue/runtime';

export function Teammate() {
  useModel('cloudflare/@cf/moonshotai/kimi-k2.6');
  return 'You are a sales teammate. Reply with exactly: ACK:<the task text>. No other words.';
}
