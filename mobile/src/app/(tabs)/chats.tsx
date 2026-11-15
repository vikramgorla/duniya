// Chats: groups and direct chats the WhatsApp numbers see, with filters and search. Tap to assign an agent.
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Body, Card, Divider, Field, Led, ListRow, Loading, Screen, Segmented } from '@/components/ui';
import { chatLabel } from '@/lib/format';
import type { Agent, Chat } from '@/lib/types';
import { useData } from '@/lib/useData';

type Filter = 'all' | 'groups' | 'direct' | 'agent' | 'none';

export default function Chats() {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const chats = useData<Chat[]>('chats', (a) => a.get('/api/chats'));
  const agents = useData<Agent[]>('agents', (a) => a.get('/api/agents'));
  const names = useMemo(() => Object.fromEntries((agents.data || []).map((b) => [b.id, b.name])), [agents.data]);
  const list = (chats.data || []).filter((c) => (filter === 'groups' ? c.isGroup : filter === 'direct' ? !c.isGroup : filter === 'agent' ? !!c.agent : filter === 'none' ? !c.agent : true))
    .filter((c) => !q || `${c.name} ${c.id}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(!!b.agent) - Number(!!a.agent) || chatLabel(a.id, a.name).localeCompare(chatLabel(b.id, b.name)));
  return (
    <Screen onRefresh={() => { chats.refresh(); agents.reload(); }} refreshing={chats.refreshing} error={chats.data ? null : chats.error} stale={chats.stale}>
      <Segmented label="Filter chats" value={filter} onChange={setFilter} options={[
        { value: 'all', label: 'All' }, { value: 'groups', label: 'Groups' }, { value: 'direct', label: 'Direct' }, { value: 'agent', label: 'Agent' }, { value: 'none', label: 'None' }]} />
      <Field label="Search" value={q} onChangeText={setQ} placeholder="Name or number" autoCapitalize="none" clearButtonMode="while-editing" />
      {!chats.data ? <Loading /> : (
        <Card style={{ paddingVertical: 4, gap: 0 }}>
          {list.length === 0 ? <Body muted style={{ paddingVertical: 14 }}>No chats match.</Body> : null}
          {list.map((c) => (
            <ListRow key={c.id} title={chatLabel(c.id, c.name)} left={<Led tone={c.agent ? 'ok' : 'off'} />}
              subtitle={[c.agent ? names[c.agent] || c.agent : 'no agent', c.isGroup ? `${c.size || 0} members` : 'direct chat', c.numberLabel].filter(Boolean).join(' · ')}
              onPress={() => router.push({ pathname: '/chat/[id]', params: { id: c.id } })} />
          )).flatMap((el, i) => (i ? [<Divider key={`d${i}`} />, el] : [el]))}
        </Card>
      )}
    </Screen>
  );
}
