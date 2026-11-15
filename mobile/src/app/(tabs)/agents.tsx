// Agents: list with live LEDs and an on/off switch (admins). Tap for details, edits and "Change with AI".
import { useRouter } from 'expo-router';
import { Alert, View } from 'react-native';
import { Body, Card, Empty, H2, Label, Led, Loading, Pill, Row, Screen, Spread, Toggle } from '@/components/ui';
import { can, useAuth } from '@/lib/auth';
import type { Agent } from '@/lib/types';
import { useData } from '@/lib/useData';

export default function Agents() {
  const router = useRouter();
  const { api, user } = useAuth();
  const { data, error, stale, refreshing, refresh, setData } = useData<Agent[]>('agents', (a) => a.get('/api/agents'));
  const toggle = async (b: Agent, enabled: boolean) => {
    setData(data?.map((x) => (x.id === b.id ? { ...x, enabled } : x)));
    try { await api!.put(`/api/agents/${encodeURIComponent(b.id)}`, { enabled }); }
    catch (e) { setData(data); Alert.alert('Not changed', (e as Error).message); }
  };
  return (
    <Screen onRefresh={refresh} refreshing={refreshing} error={data ? null : error} stale={stale}>
      {!data ? <Loading /> : data.length === 0 ? <Empty title="No agents yet">Create your first agent in the web panel (Agents → New, or with AI).</Empty> : null}
      {data?.map((b) => (
        <Card key={b.id} onPress={() => router.push({ pathname: '/agent/[id]', params: { id: b.id } })} accessibilityLabel={`${b.name}, ${b.enabled ? 'on' : 'off'}`}>
          <Spread>
            <Row style={{ flex: 1 }}><Led tone={b.enabled ? 'ok' : 'off'} /><H2 style={{ flex: 1 }}>{b.name}</H2></Row>
            <Toggle label={`${b.name} on or off`} value={b.enabled} onChange={(v) => toggle(b, v)} disabled={!can(user, 'admin')} />
          </Spread>
          {b.description ? <Body muted numberOfLines={2}>{b.description}</Body> : null}
          <Row wrap gap={8}>
            <Pill>{b.enabled ? 'on' : 'off'}</Pill>
            <Label>{`${b.config.chats?.length || 0} chats`}</Label>
            <Label>{`model ${b.config.model || 'auto'}`}</Label>
          </Row>
          {b.needs.length ? <View><Pill tone="warn">{`needs ${b.needs.join(', ')}`}</Pill></View> : null}
        </Card>
      ))}
    </Screen>
  );
}
