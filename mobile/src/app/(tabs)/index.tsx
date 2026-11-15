// Overview: the status console (DESIGN.md) — one sentence about the state, LEDs for WhatsApp, agents and waiting
// changes, the WhatsApp numbers, live agents. Refreshes every 10 s while open, and on pull.
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Logo } from '@/components/Logo';
import { Body, Button, Card, Divider, Field, H2, Label, Led, LedLabel, ListRow, Loading, Mono, Note, Pill, Row, Screen, Spread, Title, Toggle } from '@/components/ui';
import { can, useAuth } from '@/lib/auth';
import { ago, duration } from '@/lib/format';
import { headline, numbersOf, numberState, numberTone } from '@/lib/status';
import { useTheme } from '@/lib/theme';
import type { Status } from '@/lib/types';
import { useData } from '@/lib/useData';

export default function Overview() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { api, user, server, demo } = useAuth();
  const { data: st, error, stale, refreshing, refresh, setData } = useData<Status>('status', (a) => a.get('/api/status'), { interval: 10_000 });

  const setPaused = (paused: boolean) => {
    const apply = async () => {
      try { await api!.post('/api/settings', { paused }); setData(st && { ...st, settings: { ...st.settings, paused } }); }
      catch (e) { Alert.alert('Not changed', (e as Error).message); }
    };
    if (paused) Alert.alert('Pause all agents?', 'No agent answers in any chat until you resume. Scheduled posts wait too.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Pause all', style: 'destructive', onPress: apply }]);
    else apply();
  };

  const host = demo ? 'demo data' : server.replace(/^https?:\/\//, '');
  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top }}>
      <Screen onRefresh={refresh} refreshing={refreshing} error={st ? null : error} stale={stale}>
        <Spread>
          <Row><Logo size={34} /><View><Title style={{ fontSize: 22 }}>Duniya</Title><Label>{host}</Label></View></Row>
          {user ? <Pill>{user.role}</Pill> : null}
        </Spread>
        {!st ? <Loading /> : <Console st={st} canAdmin={can(user, 'admin')} onPause={setPaused} onPending={() => router.push('/pending')} />}
        {st ? (
          <>
            <Ask />
            <Card>
              <Spread><H2>WhatsApp numbers</H2><Pill>{`${numbersOf(st).filter((n) => n.status === 'open').length}/${numbersOf(st).length} connected`}</Pill></Spread>
              {numbersOf(st).map((n, i) => (
                <View key={n.id} style={{ gap: 4 }}>
                  {i ? <Divider /> : null}
                  <Spread style={{ paddingVertical: 4 }}>
                    <Row><Led tone={numberTone(n)} /><Body style={{ fontWeight: '600' }}>{n.label}</Body>{n.status === 'open' && n.me ? <Mono size={12} style={{ color: t.muted }}>{`+${n.me.split(':')[0].split('@')[0]}`}</Mono> : null}</Row>
                    <Pill tone={numberTone(n) === 'ok' ? 'ok' : numberTone(n) === 'warn' ? 'warn' : 'bad'}>{numberState(n)}</Pill>
                  </Spread>
                  {n.status !== 'open' ? <Body small muted>{n.status === 'qr' ? 'Link it in the web panel: Overview → scan the QR with WhatsApp on that phone.' : `Changed ${ago(n.since)} ago. If it stays like this, use Reconnect in the web panel.`}</Body> : null}
                  {n.lastError && n.status !== 'open' ? <Body small style={{ color: t.bad }}>{n.lastError}</Body> : null}
                </View>
              ))}
            </Card>
            <Card>
              <Spread><H2>Agents</H2><Button small kind="ghost" title="All agents" onPress={() => router.push('/agents')} /></Spread>
              {st.agents.length ? st.agents.map((b) => (
                <ListRow key={b.id} title={b.name} subtitle={b.chats ? `${b.chats} chat${b.chats > 1 ? 's' : ''}` : 'not in any chat yet'}
                  left={<Led tone={st.settings.paused ? 'warn' : b.enabled ? 'ok' : 'off'} />} onPress={() => router.push({ pathname: '/agent/[id]', params: { id: b.id } })} />
              )) : <Body muted>No agents yet. Create one in the web panel (Agents → New), or with AI there.</Body>}
            </Card>
            <Row wrap style={{ justifyContent: 'center', paddingVertical: 4 }} gap={14}>
              <Label>{st.version}</Label><Label>{`up ${duration(st.uptimeSec)}`}</Label><Label>{`${st.memoryMb} MB`}</Label>
            </Row>
          </>
        ) : null}
      </Screen>
    </View>
  );
}

function Console({ st, canAdmin, onPause, onPending }: { st: Status; canAdmin: boolean; onPause: (v: boolean) => void; onPending: () => void }) {
  const h = headline(st);
  const numbers = numbersOf(st);
  const open = numbers.filter((n) => n.status === 'open').length;
  const live = st.agents.filter((b) => b.enabled).length;
  return (
    <Card accessibilityLabel={h.text}>
      <Label>Status</Label>
      <Row><Led tone={h.tone} size={11} /><H2 style={{ fontSize: 21, flex: 1 }}>{h.text}</H2></Row>
      <Row gap={8} style={{ marginTop: 4 }}>
        <LedLabel tone={open === numbers.length ? 'ok' : 'bad'} label="WhatsApp" value={`${open}/${numbers.length}`} />
        <LedLabel tone={st.settings.paused ? 'warn' : live ? 'ok' : 'off'} label="Agents" value={st.settings.paused ? 'paused' : `${live} live`} />
        <LedLabel tone={st.pending ? 'warn' : 'off'} label="Waiting" value={String(st.pending)} />
      </Row>
      {st.pending ? <Button kind="primary" title={`Review ${st.pending} waiting change${st.pending > 1 ? 's' : ''}`} onPress={onPending} /> : null}
      <Divider />
      <Spread>
        <View style={{ flex: 1 }}><Body style={{ fontWeight: '600' }}>Pause all agents</Body><Body small muted>{canAdmin ? 'Stops every reply right away; resume any time.' : 'Only admins can pause.'}</Body></View>
        <Toggle label="Pause all agents" value={!!st.settings.paused} onChange={onPause} disabled={!canAdmin} />
      </Spread>
    </Card>
  );
}

/** Ask (044): the owner assistant, same API as the panel's Ask box. Changes need Confirm. */
type Held = { code: string; preview: string };
function Ask() {
  const { api } = useAuth();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState('');
  const [held, setHeld] = useState<Held[]>([]);
  const send = async () => {
    if (!q.trim() || busy) return;
    setBusy(true); setReply(''); setHeld([]);
    try {
      const r = await api!.post<{ reply: string; confirms: Held[] }>('/api/owner/ask', { question: q });
      setReply(r.reply); setHeld(r.confirms || []); setQ('');
    } catch (e) { Alert.alert('No answer', (e as Error).message); }
    setBusy(false);
  };
  const decide = async (c: Held, cancel: boolean) => {
    try { const r = await api!.post<{ reply: string }>('/api/owner/ask/confirm', { code: c.code, cancel }); setReply((x) => `${x}\n\n${r.reply}`.trim()); }
    catch (e) { Alert.alert('Not changed', (e as Error).message); }
    setHeld((h) => h.filter((x) => x !== c));
  };
  return (
    <Card>
      <H2>Ask</H2>
      <Body small muted>Looks across the chats that are on (not those private to members). Changes need your Confirm.</Body>
      <Field label="Your question" placeholder="What did the families decide this week?" value={q} onChangeText={setQ} multiline style={{ minHeight: 70 }} />
      <Button kind="primary" title="Ask" busy={busy} disabled={!q.trim()} onPress={send} />
      {reply ? <Note><Body selectable>{reply}</Body></Note> : null}
      {held.map((c) => (
        <Note key={c.code} tone="warn">
          <Body>{c.preview}</Body>
          <Row gap={8} style={{ marginTop: 8 }}>
            <Button small kind="primary" title="Confirm" onPress={() => decide(c, false)} />
            <Button small title="Cancel" onPress={() => decide(c, true)} />
          </Row>
        </Note>
      ))}
    </Card>
  );
}
