// One sentence about the state of the platform (same rules as the panel's status console). Pure.
import type { Status, WaNumber } from './types.ts';

export type Tone = 'ok' | 'warn' | 'bad' | 'off';

export function numbersOf(st: Status): WaNumber[] {
  return st.channel.numbers?.length ? st.channel.numbers : [{ ...st.channel, id: st.channel.id || 'main', label: st.channel.label || 'Main' }];
}

export function numberTone(n: Pick<WaNumber, 'status'>): Tone {
  if (n.status === 'open') return 'ok';
  if (['qr', 'reconnecting', 'starting', 'connecting'].includes(n.status)) return 'warn';
  return 'bad';
}

export function numberState(n: Pick<WaNumber, 'status'>): string {
  if (n.status === 'open') return 'connected';
  if (n.status === 'qr') return 'waiting for scan';
  return n.status.replace(/_/g, ' ');
}

export function headline(st: Status): { text: string; tone: Tone } {
  const numbers = numbersOf(st);
  const open = numbers.filter((n) => n.status === 'open').length;
  const live = st.agents.filter((b) => b.enabled).length;
  if (st.settings.paused) return { text: 'All agents are paused', tone: 'warn' };
  if (open === numbers.length && live > 0) return { text: st.pending ? 'Running · changes are waiting for you' : 'Everything is running', tone: st.pending ? 'warn' : 'ok' };
  if (open < numbers.length) return { text: numbers.length > 1 ? 'A WhatsApp number needs attention' : 'WhatsApp needs attention', tone: 'bad' };
  if (!live) return { text: 'No agent is switched on yet', tone: 'off' };
  return { text: 'Running, with something to check', tone: 'warn' };
}
