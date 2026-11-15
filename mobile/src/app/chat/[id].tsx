// Chat detail: which agent answers here (or none = off), which model, and the stored messages (admins; each look is
// recorded in Activity, as in the panel).
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { Body, Button, Card, Divider, H2, Label, Led, Loading, Note, Row, Screen, Spread } from '@/components/ui';
import { can, useAuth } from '@/lib/auth';
import { ago, chatLabel } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import type { Bot, Chat, ModelList, StoredMessage } from '@/lib/types';
import { useData } from '@/lib/useData';

export default function ChatDetail() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, user } = useAuth();
  const admin = can(user, 'admin');
  const chats = useData<Chat[]>('chats', (a) => a.get('/api/chats'));
  const bots = useData<Bot[]>('bots', (a) => a.get('/api/bots'));
  const models = useData<ModelList>(admin ? 'models' : null, (a) => a.get('/api/models'));
  const [msgs, setMsgs] = useState<StoredMessage[] | null>(null);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const chat = chats.data?.find((c) => c.id === id);
  if (!chat) return <Screen error={chats.error}>{chats.data ? <Note tone="warn">This chat is not visible right now.</Note> : <Loading />}</Screen>;

  const update = (patch: Partial<Chat>) => chats.setData(chats.data?.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const bind = async (bot: string) => {
    const before = chat.bot; update({ bot });
    try { await api!.post('/api/chats/bind', { chat: id, bot: bot || null }); } catch (e) { update({ bot: before }); Alert.alert('Not changed', (e as Error).message); }
  };
  const setModel = async (model: string) => {
    const before = chat.model; update({ model });
    try { await api!.put(`/api/chats/${encodeURIComponent(id)}/prefs`, { model }); } catch (e) { update({ model: before }); Alert.alert('Not changed', (e as Error).message); }
  };
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
        <Row><Led tone={chat.bot ? 'ok' : 'off'} size={11} /><H2 style={{ flex: 1 }}>{chat.bot ? `${bots.data?.find((b) => b.id === chat.bot)?.name || chat.bot} answers here` : 'No agent answers here'}</H2></Row>
        <Row wrap gap={8}><Label>{chat.isGroup ? `group · ${chat.size || 0} members` : 'direct chat'}</Label><Label>{`number ${chat.numberLabel}`}</Label></Row>
      </Card>
      <Card style={{ gap: 0 }}>
        <H2 style={{ marginBottom: 6 }}>Agent</H2>
        {!admin ? <Note>Only admins can change this.</Note> : null}
        {option('none', 'No agent (off)', !chat.bot, () => bind(''))}
        {(bots.data || []).map((b) => option(b.id, b.name, chat.bot === b.id, () => bind(b.id), b.enabled ? undefined : 'switched off'))}
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
              <Spread><Label color={m.fromBot ? t.ok : undefined}>{m.fromBot ? `agent${m.name ? ` · ${m.name}` : ''}` : m.name || (m.sender ? `+${m.sender}` : 'someone')}</Label><Label>{`${ago(m.ts)} ago`}</Label></Spread>
              <Body selectable>{m.text}</Body>
            </View>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}
