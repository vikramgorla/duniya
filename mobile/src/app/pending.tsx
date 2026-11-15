// Waiting for you: changes an agent prepared (preview → confirm). Approving applies the change now; cancelling drops it.
import { Alert, View } from 'react-native';
import { Body, Button, Card, Empty, H2, Label, Loading, Mono, Note, Row, Screen, Spread } from '@/components/ui';
import { can, useAuth } from '@/lib/auth';
import { chatLabel } from '@/lib/format';
import type { Agent, Chat, Pending as P } from '@/lib/types';
import { useData } from '@/lib/useData';

const left = (ts: number) => { const m = Math.max(0, Math.round((ts - Date.now()) / 60000)); return m < 1 ? 'expires now' : `${m} min left`; };

export default function Pending() {
  const { api, user } = useAuth();
  const admin = can(user, 'admin');
  const list = useData<P[]>('pending', (a) => a.get('/api/pending'), { interval: 10_000 });
  const agents = useData<Agent[]>('agents', (a) => a.get('/api/agents'));
  const chats = useData<Chat[]>('chats', (a) => a.get('/api/chats'));
  const drop = (code: string) => list.setData(list.data?.filter((x) => x.code !== code));
  const approve = (p: P) => Alert.alert('Apply this change?', p.summary, [
    { text: 'Not now', style: 'cancel' },
    { text: 'Apply', onPress: async () => {
      try { const r = await api!.post<{ result: unknown }>(`/api/pending/${encodeURIComponent(p.code)}/apply`); drop(p.code); Alert.alert('Done', typeof r.result === 'string' ? r.result.slice(0, 300) : 'The change was applied.'); }
      catch (e) { Alert.alert('Not applied', (e as Error).message); list.reload(); }
    } },
  ]);
  const cancel = (p: P) => Alert.alert('Cancel this change?', 'The agent will not make it. The person can ask again.', [
    { text: 'Keep it', style: 'cancel' },
    { text: 'Cancel change', style: 'destructive', onPress: async () => { try { await api!.del(`/api/pending/${encodeURIComponent(p.code)}`); drop(p.code); } catch (e) { Alert.alert('Not cancelled', (e as Error).message); } } },
  ]);
  return (
    <Screen onRefresh={list.refresh} refreshing={list.refreshing} error={list.data ? null : list.error} stale={list.stale}>
      {!list.data ? <Loading /> : list.data.length === 0 ? <Empty title="Nothing is waiting">When an agent prepares a change (a room, a booking, an event), it waits here and in the chat until an organizer says yes.</Empty> : null}
      {!admin && list.data?.length ? <Note>Only admins can apply or cancel. Organizers can also confirm in the chat with the code.</Note> : null}
      {list.data?.map((p) => (
        <Card key={p.code}>
          <Spread><Mono style={{ fontWeight: '700' }}>{p.code}</Mono><Label>{left(p.expires)}</Label></Spread>
          <H2>{p.summary}</H2>
          <View style={{ gap: 2 }}>
            <Label>{`${agents.data?.find((b) => b.id === p.agent)?.name || p.agent} · ${chatLabel(p.chat, chats.data?.find((c) => c.id === p.chat)?.name)}`}</Label>
            <Body small muted>{`Asked by ${p.requester} · ${p.tool}`}</Body>
          </View>
          {admin ? <Row><Button kind="primary" title="Apply" onPress={() => approve(p)} style={{ flex: 1 }} /><Button kind="danger" title="Cancel" onPress={() => cancel(p)} style={{ flex: 1 }} /></Row> : null}
        </Card>
      ))}
    </Screen>
  );
}
