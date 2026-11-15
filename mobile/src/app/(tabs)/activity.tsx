// Activity: what the agents did (messages, tool calls, confirmations, settings), newest first, refreshed every 10 s.
import { useState } from 'react';
import { View } from 'react-native';
import { Body, Button, Card, Divider, Label, Loading, Pill, Row, Screen, Segmented, Spread, type NoteTone } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { ago, chatLabel } from '@/lib/format';
import type { Activity as Act, Bot, Chat } from '@/lib/types';
import { useData } from '@/lib/useData';

const TONE: Record<string, NoteTone | 'plain'> = {
  'message.in': 'info', 'message.out': 'ok', 'tool.error': 'bad', error: 'bad', 'confirm.created': 'warn', 'confirm.applied': 'ok',
  'confirm.cancelled': 'warn', 'channel.status': 'info', 'schedule.run': 'info', 'bot.created': 'ok', 'bot.deleted': 'warn', 'memory.erased': 'bad', 'mcp.call': 'info',
};
const LABEL: Record<string, string> = { 'message.in': 'in', 'message.out': 'reply', 'tool.call': 'tool', 'tool.error': 'tool error', 'confirm.created': 'waiting', 'confirm.applied': 'confirmed', 'confirm.cancelled': 'cancelled', 'channel.status': 'whatsapp', 'schedule.run': 'schedule', 'mcp.call': 'assistant' };
type Kind = 'all' | 'messages' | 'changes' | 'problems';
const match = (k: Kind, a: Act) => k === 'all' || (k === 'messages' ? a.type.startsWith('message.') : k === 'changes' ? a.type.startsWith('confirm.') || a.type === 'config' || a.type.startsWith('bot.') : a.type === 'error' || a.type.endsWith('.error'));

export default function Activity() {
  const { api } = useAuth();
  const [kind, setKind] = useState<Kind>('all');
  const [older, setOlder] = useState<Act[]>([]);
  const [busy, setBusy] = useState(false);
  const acts = useData<Act[]>('activity', (a) => a.get('/api/activity?limit=100'), { interval: 10_000 });
  const bots = useData<Bot[]>('bots', (a) => a.get('/api/bots'));
  const chats = useData<Chat[]>('chats', (a) => a.get('/api/chats'));
  const botName = (id: string | null) => (id && bots.data?.find((b) => b.id === id)?.name) || id || '';
  const chatName = (id: string | null) => (id ? chatLabel(id, chats.data?.find((c) => c.id === id)?.name) : '');
  const all = [...(acts.data || []), ...older.filter((o) => !(acts.data || []).some((a) => a.id === o.id))];
  const list = all.filter((a) => match(kind, a));
  const more = async () => {
    const last = all.at(-1); if (!last) return;
    setBusy(true);
    try { const rows = await api!.get<Act[]>(`/api/activity?limit=100&before=${last.id}`); setOlder((o) => [...o, ...rows]); } catch { /* banner shows offline */ } finally { setBusy(false); }
  };
  return (
    <Screen onRefresh={acts.refresh} refreshing={acts.refreshing} error={acts.data ? null : acts.error} stale={acts.stale}>
      <Segmented label="Show" value={kind} onChange={setKind} options={[{ value: 'all', label: 'All' }, { value: 'messages', label: 'Messages' }, { value: 'changes', label: 'Changes' }, { value: 'problems', label: 'Problems' }]} />
      {!acts.data ? <Loading /> : (
        <Card style={{ gap: 0, paddingVertical: 6 }}>
          {list.length === 0 ? <Body muted style={{ paddingVertical: 14 }}>Nothing here yet.</Body> : null}
          {list.map((a, i) => (
            <View key={a.id}>
              {i ? <Divider /> : null}
              <View style={{ paddingVertical: 10, gap: 5 }} accessible accessibilityLabel={`${LABEL[a.type] || a.type}, ${ago(a.ts)} ago: ${a.summary}`}>
                <Spread><Pill tone={TONE[a.type] || 'plain'}>{LABEL[a.type] || a.type}</Pill><Label>{`${ago(a.ts)} ago`}</Label></Spread>
                <Body selectable numberOfLines={4}>{a.summary}</Body>
                {a.bot || a.chat ? <Row gap={8} wrap>{a.bot ? <Label>{botName(a.bot)}</Label> : null}{a.chat ? <Label>{chatName(a.chat)}</Label> : null}</Row> : null}
              </View>
            </View>
          ))}
        </Card>
      )}
      {acts.data && acts.data.length >= 100 ? <Button title="Load older" onPress={more} busy={busy} /> : null}
    </Screen>
  );
}
