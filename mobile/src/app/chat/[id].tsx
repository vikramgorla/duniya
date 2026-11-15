// Chat detail: which agent answers here (or none = off), which model and what happens when it is unavailable, privacy
// (private to members, privacy notice) and the stored messages (admins; each look is recorded in Activity, as in the
// panel).
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { Body, Button, Card, Divider, H2, Label, Led, Loading, Note, Row, Screen, Spread, Toggle } from '@/components/ui';
import { modelLabel } from '@/lib/ai-review';
import { can, useAuth } from '@/lib/auth';
import { ago, chatLabel } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import type { Agent, Chat, ModelList, StoredMessage } from '@/lib/types';
import { useData } from '@/lib/useData';

export default function ChatDetail() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, user } = useAuth();
  const admin = can(user, 'admin');
  const chats = useData<Chat[]>('chats', (a) => a.get('/api/chats'));
  const agents = useData<Agent[]>('agents', (a) => a.get('/api/agents'));
  const models = useData<ModelList>(admin ? 'models' : null, (a) => a.get('/api/models'));
  const [msgs, setMsgs] = useState<StoredMessage[] | null>(null);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const chat = chats.data?.find((c) => c.id === id);
  if (!chat) return <Screen error={chats.error}>{chats.data ? <Note tone="warn">This chat is not visible right now.</Note> : <Loading />}</Screen>;

  const update = (patch: Partial<Chat>) => chats.setData(chats.data?.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const bind = async (agent: string) => {
    const before = chat.agent; update({ agent });
    try { await api!.post('/api/chats/bind', { chat: id, agent: agent || null }); } catch (e) { update({ agent: before }); Alert.alert('Not changed', (e as Error).message); }
  };
  const setModel = async (model: string) => {
    const before = chat.model; update({ model });
    try { await api!.put(`/api/chats/${encodeURIComponent(id)}/prefs`, { model }); } catch (e) { update({ model: before }); Alert.alert('Not changed', (e as Error).message); }
  };
  // 044 / #63: the same prefs the panel's Chats page sets (one field per request, like the panel)
  const setPref = async (patch: Partial<Chat>) => {
    const before = { ...chat }; update(patch);
    try { update(await api!.put<Partial<Chat>>(`/api/chats/${encodeURIComponent(id)}/prefs`, patch)); } catch (e) { update(before); Alert.alert('Not changed', (e as Error).message); }
  };
  const fb = chat.fallback || { mode: 'inherit' as const, chain: [] };
  const loadMessages = async () => {
    setLoadingMsgs(true);
    try { setMsgs(await api!.get<StoredMessage[]>(`/api/chats/${encodeURIComponent(id)}/messages?limit=50`)); } catch (e) { Alert.alert('Cannot show messages', (e as Error).message); } finally { setLoadingMsgs(false); }
  };
  const option = (key: string, label: string, on: boolean, onPress: () => void, sub?: string) => (
    <Pressable key={key} accessibilityRole="radio" accessibilityState={{ checked: on, disabled: !admin }} disabled={!admin} onPress={onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 46, paddingVertical: 6, opacity: pressed ? 0.6 : 1 })}>
      <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: on ? t.ink : t.line2, alignItems: 'center', justifyContent: 'center' }}>
        {on ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: t.dark ? t.signal : t.ink }} /> : null}
      </View>
      <View style={{ flex: 1 }}><Text style={{ color: t.ink, fontSize: 16 }}>{label}</Text>{sub ? <Text style={{ color: t.muted, fontSize: 13 }}>{sub}</Text> : null}</View>
    </Pressable>
  );
  return (
    <Screen onRefresh={chats.refresh} refreshing={chats.refreshing} stale={chats.stale}>
      <Stack.Screen options={{ title: chatLabel(chat.id, chat.name) }} />
      <Card>
        <Row><Led tone={chat.agent ? 'ok' : 'off'} size={11} /><H2 style={{ flex: 1 }}>{chat.agent ? `${agents.data?.find((b) => b.id === chat.agent)?.name || chat.agent} answers here` : 'No agent answers here'}</H2></Row>
        <Row wrap gap={8}><Label>{chat.isGroup ? `group · ${chat.size || 0} members` : 'direct chat'}</Label><Label>{`number ${chat.numberLabel}`}</Label></Row>
      </Card>
      <Card style={{ gap: 0 }}>
        <H2 style={{ marginBottom: 6 }}>Agent</H2>
        {!admin ? <Note>Only admins can change this.</Note> : null}
        {option('none', 'No agent (off)', !chat.agent, () => bind(''))}
        {(agents.data || []).map((b) => option(b.id, b.name, chat.agent === b.id, () => bind(b.id), b.enabled ? undefined : 'switched off'))}
      </Card>
      {admin ? (
        <Card style={{ gap: 0 }}>
          <H2 style={{ marginBottom: 6 }}>Model in this chat</H2>
          {option('inherit', 'Same as the agent', chat.model === 'inherit', () => setModel('inherit'))}
          {option('auto', 'Auto', chat.model === 'auto', () => setModel('auto'), models.data?.resolvedDefault ? `now ${models.data.resolvedDefault}` : undefined)}
          {(models.data?.models || []).slice(0, 12).map((m) => option(m.ref, m.label, chat.model === m.ref, () => setModel(m.ref)))}
        </Card>
      ) : null}
      {admin ? (
        <Card style={{ gap: 0 }}>
          <H2 style={{ marginBottom: 6 }}>If the model is unavailable</H2>
          {option('fb-inherit', 'As the agent', fb.mode === 'inherit', () => setPref({ fallback: { mode: 'inherit', chain: fb.chain } }))}
          {option('fb-on', 'Switch to another model', fb.mode === 'on', () => setPref({ fallback: { mode: 'on', chain: fb.chain } }),
            fb.chain.length ? `in order: ${fb.chain.map((r) => modelLabel(r, models.data)).join(' → ')}` : 'the agent’s or the Models list')}
          {option('fb-off', 'Don’t switch', fb.mode === 'off', () => setPref({ fallback: { mode: 'off', chain: [] } }))}
          <Body small muted style={{ marginTop: 6 }}>Only for limits, outages and expired sign-ins. The list of models is edited in the web panel (Chats → Fallback…).</Body>
        </Card>
      ) : null}
      <Card>
        <H2>Privacy</H2>
        <Spread>
          <View style={{ flex: 1 }}><Body style={{ fontWeight: '600' }}>Private to members</Body><Body small muted>The agent keeps working here, but the owner assistant and the Ask box never see this chat.</Body></View>
          <Toggle label="Private to members" value={!!chat.private} onChange={(v) => setPref({ private: v })} disabled={!admin} />
        </Spread>
        {chat.isGroup ? (
          <>
            <Divider />
            <Spread>
              <View style={{ flex: 1 }}><Body style={{ fontWeight: '600' }}>Privacy notice</Body><Body small muted>{chat.noticePostedAt ? `Posted ${ago(chat.noticePostedAt)} ago.` : 'Posted once when this group is switched on.'}</Body></View>
              <Toggle label="Privacy notice" value={!chat.noticeOff} onChange={(v) => setPref({ noticeOff: !v })} disabled={!admin} />
            </Spread>
          </>
        ) : null}
      </Card>
      {admin ? (
        <Card>
          <Spread><H2>Stored messages</H2>{msgs ? <Button small kind="ghost" title="Reload" onPress={loadMessages} /> : null}</Spread>
          {!msgs ? (
            <>
              <Body muted small>Messages the agents keep for context. Looking is recorded in Activity, so the group can trust what admins see.</Body>
              <Button title="Show the last 50" busy={loadingMsgs} onPress={loadMessages} />
            </>
          ) : msgs.length === 0 ? <Body muted>No stored messages.</Body> : msgs.map((m, i) => (
            <View key={m.id} style={{ gap: 3 }}>
              {i ? <Divider /> : null}
              <Spread><Label color={m.fromAgent ? t.ok : undefined}>{m.fromAgent ? `agent${m.name ? ` · ${m.name}` : ''}` : m.name || (m.sender ? `+${m.sender}` : 'someone')}</Label><Label>{`${ago(m.ts)} ago`}</Label></Spread>
              <Body selectable>{m.text}</Body>
            </View>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}
