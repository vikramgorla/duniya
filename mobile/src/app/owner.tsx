// Owner assistant (044, app parity #63): is my WhatsApp linked, unlink, who else is linked (owners). Linking itself
// starts in the web panel: the code is only handed to a panel session. 059: its model, character, tools and schedules
// are the built-in agent "owner-assistant", opened in the agent screen.
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { Body, Button, Card, Divider, H2, Label, Led, Loading, Note, Row, Screen, Spread } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { ago } from '@/lib/format';
import type { OwnerAssistantInfo } from '@/lib/types';
import { useData } from '@/lib/useData';

export default function OwnerAssistant() {
  const router = useRouter();
  const { api } = useAuth();
  const info = useData<OwnerAssistantInfo>('owner-assistant', (a) => a.get('/api/owner-assistant'));
  const [busy, setBusy] = useState(false);
  const o = info.data;
  if (!o) return <Screen error={info.error}><Loading /></Screen>;
  const l = o.link;

  const unlink = (path: string, who: string) => Alert.alert(`Unlink ${who}?`, 'The owner assistant stops answering this number. You can link it again from the web panel.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Unlink', style: 'destructive', onPress: async () => { setBusy(true); try { await api!.del(path); await info.refresh(); } catch (e) { Alert.alert('Not changed', (e as Error).message); } setBusy(false); } },
  ]);
  const sendTo = o.sendTo.map((n) => `+${n.phone}`).join(' or ') || 'an agent number';
  return (
    <Screen onRefresh={info.refresh} refreshing={info.refreshing} stale={info.stale}>
      <Card>
        <Row><Led tone={l.status === 'linked' ? 'ok' : l.status === 'none' ? 'off' : 'warn'} size={11} />
          <H2 style={{ flex: 1 }}>{l.status === 'linked' ? `Linked to +${l.phone}` : l.status === 'pending' ? `Waiting: is +${l.phone} yours?` : l.status === 'code' ? 'A link code is waiting' : 'Your WhatsApp is not linked'}</H2></Row>
        <Body small muted>Ask about all chats from your own WhatsApp chat with {sendTo}, or from the Ask box. It sees only chats that are on and not private to members; changes always need “confirm CODE”.</Body>
        {l.status === 'linked' ? (
          <>
            {l.linkedAt ? <Label>{`linked ${ago(l.linkedAt)} ago`}</Label> : null}
            <Button kind="danger" title="Unlink my WhatsApp" busy={busy} onPress={() => unlink('/api/owner-assistant/link', `+${l.phone}`)} />
          </>
        ) : (
          <Note>{l.status === 'pending' ? 'Confirm it in the web panel: Settings → Owner assistant.' : 'Link it in the web panel: Settings → Owner assistant → Link my WhatsApp. The one-time code is only shown there.'}</Note>
        )}
        {l.status === 'pending' || l.status === 'code' ? <Button title="Cancel linking" busy={busy} onPress={() => unlink('/api/owner-assistant/link', 'this number')} /> : null}
      </Card>
      <Button title="Character, model, tools & schedules" onPress={() => router.push({ pathname: '/agent/[id]', params: { id: o.agent } })} />
      {o.links?.length ? (
        <Card>
          <H2>{`Linked people (${o.links.length})`}</H2>
          {o.links.map((x, i) => (
            <View key={x.userId} style={{ gap: 4 }}>
              {i ? <Divider /> : null}
              <Spread>
                <View style={{ flex: 1 }}><Body style={{ fontWeight: '600' }}>{x.username}</Body><Label>{`+${x.phone}`}</Label></View>
                <Button small kind="danger" title="Unlink" busy={busy} onPress={() => unlink(`/api/owner-assistant/links/${x.userId}`, `${x.username} (+${x.phone})`)} />
              </Spread>
            </View>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}
