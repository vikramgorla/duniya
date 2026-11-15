// Owner assistant (044, app parity #63): is my WhatsApp linked, unlink, which model it uses (admins), who else is
// linked (owners). Linking itself starts in the web panel: the code is only handed to a panel session.
import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { Body, Button, Card, Divider, H2, Label, Led, Loading, Note, Row, Screen, Spread } from '@/components/ui';
import { modelLabel } from '@/lib/ai-review';
import { can, useAuth } from '@/lib/auth';
import { ago } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import type { ModelList, OwnerAssistantInfo } from '@/lib/types';
import { useData } from '@/lib/useData';

export default function OwnerAssistant() {
  const t = useTheme();
  const { api, user } = useAuth();
  const admin = can(user, 'admin');
  const info = useData<OwnerAssistantInfo>('owner-assistant', (a) => a.get('/api/owner-assistant'));
  const models = useData<ModelList>(admin ? 'models' : null, (a) => a.get('/api/models'));
  const [busy, setBusy] = useState(false);
  const o = info.data;
  if (!o) return <Screen error={info.error}><Loading /></Screen>;
  const l = o.link;

  const unlink = (path: string, who: string) => Alert.alert(`Unlink ${who}?`, 'The owner assistant stops answering this number. You can link it again from the web panel.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Unlink', style: 'destructive', onPress: async () => { setBusy(true); try { await api!.del(path); await info.refresh(); } catch (e) { Alert.alert('Not changed', (e as Error).message); } setBusy(false); } },
  ]);
  const setModel = async (model: string) => {
    const before = o.settings.model; info.setData({ ...o, settings: { model } });
    try { await api!.put('/api/owner-assistant/settings', { model }); } catch (e) { info.setData({ ...o, settings: { model: before } }); Alert.alert('Not changed', (e as Error).message); }
  };
  const option = (ref: string, label: string, sub?: string) => {
    const on = o.settings.model === ref;
    return (
      <Pressable key={ref} accessibilityRole="radio" accessibilityState={{ checked: on, disabled: !admin }} disabled={!admin} onPress={() => setModel(ref)}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 46, paddingVertical: 6, opacity: pressed ? 0.6 : 1 })}>
        <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: on ? t.ink : t.line2, alignItems: 'center', justifyContent: 'center' }}>
          {on ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: t.dark ? t.signal : t.ink }} /> : null}
        </View>
        <View style={{ flex: 1 }}><Text style={{ color: t.ink, fontSize: 16 }}>{label}</Text>{sub ? <Text style={{ color: t.muted, fontSize: 13 }}>{sub}</Text> : null}</View>
      </Pressable>
    );
  };
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
      {admin ? (
        <Card style={{ gap: 0 }}>
          <H2 style={{ marginBottom: 6 }}>Model</H2>
          {option('auto', 'Default model (with fallback)', models.data?.resolvedDefault ? `now ${models.data.resolvedDefault}` : undefined)}
          {(models.data?.models || []).slice(0, 12).map((m) => option(m.ref, m.label))}
          {o.settings.model !== 'auto' && !(models.data?.models || []).some((m) => m.ref === o.settings.model) ? option(o.settings.model, modelLabel(o.settings.model, models.data), 'not available') : null}
        </Card>
      ) : <Body small muted>{`Model: ${modelLabel(o.settings.model)}. Only admins can change it.`}</Body>}
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
