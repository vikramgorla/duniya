// Chats: groups and direct chats the WhatsApp numbers see, with filters and search. Tap to assign an agent.
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Body, Card, Divider, Field, Led, ListRow, Loading, Screen, Segmented } from '@/components/ui';
import { chatLabel } from '@/lib/format';
import type { Bot, Chat } from '@/lib/types';
import { useData } from '@/lib/useData';

type Filter = 'all' | 'groups' | 'direct' | 'agent' | 'none';

export default function Chats() {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const chats = useData<Chat[]>('chats', (a) => a.get('/api/chats'));
  const bots = useData<Bot[]>('bots', (a) => a.get('/api/bots'));
  const names = useMemo(() => Object.fromEntries((bots.data || []).map((b) => [b.id, b.name])), [bots.data]);
  const list = (chats.data || []).filter((c) => (filter === 'groups' ? c.isGroup : filter === 'direct' ? !c.isGroup : filter === 'agent' ? !!c.bot : filter === 'none' ? !c.bot : true))
    .filter((c) => !q || `${c.name} ${c.id}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(!!b.bot) - Number(!!a.bot) || chatLabel(a.id, a.name).localeCompare(chatLabel(b.id, b.name)));
  return (
    <Screen onRefresh={() => { chats.refresh(); bots.reload(); }} refreshing={chats.refreshing} error={chats.data ? null : chats.error} stale={chats.stale}>
      <Segmented label="Filter chats" value={filter} onChange={setFilter} options={[
        { value: 'all', label: 'All' }, { value: 'groups', label: 'Groups' }, { value: 'direct', label: 'Direct' }, { value: 'agent', label: 'Agent' }, { value: 'none', label: 'None' }]} />
      <Field label="Search" value={q} onChangeText={setQ} placeholder="Name or number" autoCapitalize="none" clearButtonMode="while-editing" />
      {!chats.data ? <Loading /> : (
        <Card style={{ paddingVertical: 4, gap: 0 }}>
          {list.length === 0 ? <Body muted style={{ paddingVertical: 14 }}>No chats match.</Body> : null}
          {list.map((c) => (
            <ListRow key={c.id} title={chatLabel(c.id, c.name)} left={<Led tone={c.bot ? 'ok' : 'off'} />}
              subtitle={[c.bot ? names[c.bot] || c.bot : 'no agent', c.isGroup ? `${c.size || 0} members` : 'direct chat', c.numberLabel].filter(Boolean).join(' · ')}
              onPress={() => router.push({ pathname: '/chat/[id]', params: { id: c.id } })} />
          )).flatMap((el, i) => (i ? [<Divider key={`d${i}`} />, el] : [el]))}
        </Card>
      )}
    </Screen>
  );
}
