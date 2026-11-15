// Agent detail: on/off, basics (name, description, instructions, triggers) editable by admins, tools, roles and
// scheduled posts read-only, and "Change with AI". Everything else stays in the web panel.
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { Body, Button, Card, Divider, Field, H2, Label, Led, Loading, Mono, Note, Pill, Row, Screen, Spread, Toggle } from '@/components/ui';
import { can, useAuth } from '@/lib/auth';
import { ago } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import type { Bot } from '@/lib/types';
import { useData } from '@/lib/useData';

const DM: Record<string, string> = { off: 'nobody', organizers: 'organizers only', members: 'members of its groups', anyone: 'anyone' };

export default function AgentDetail() {
  const t = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, user } = useAuth();
  const admin = can(user, 'admin');
  const { data: bot, error, stale, refreshing, refresh, setData } = useData<Bot>(`bot:${id}`, (a) => a.get(`/api/bots/${encodeURIComponent(id)}`));
  const [edits, setEdits] = useState<Partial<Record<'name' | 'description' | 'prompt' | 'triggers', string>>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');
  if (!bot) return <Screen error={error}><Loading /></Screen>;
  const form = { name: bot.name, description: bot.description || '', prompt: bot.config.prompt || '', triggers: (bot.config.triggers || []).join(', '), ...edits };
  const setForm = (f: typeof form) => setEdits(f);

  const patch: Record<string, unknown> = {};
  if (form.name.trim() !== bot.name) patch.name = form.name.trim();
  if (form.description !== (bot.description || '')) patch.description = form.description;
  if (form.prompt !== (bot.config.prompt || '')) patch.prompt = form.prompt;
  const trig = form.triggers.split(',').map((s) => s.trim()).filter(Boolean);
  if (trig.join(',') !== (bot.config.triggers || []).join(',')) patch.triggers = trig;
  const dirty = Object.keys(patch).length > 0;

  const save = async () => {
    setSaving(true); setSaved('');
    try {
      const r = await api!.put<Bot & { warnings?: string[] }>(`/api/bots/${encodeURIComponent(bot.id)}`, patch);
      setData(r); setEdits({}); setSaved(r.warnings?.length ? `Saved. Note: ${r.warnings.join(' ')}` : 'Saved. The agent uses the new settings from its next message.');
    } catch (e) { Alert.alert('Not saved', (e as Error).message); } finally { setSaving(false); }
  };
  const toggle = async (enabled: boolean) => {
    try { setData({ ...bot, enabled }); await api!.put(`/api/bots/${encodeURIComponent(bot.id)}`, { enabled }); }
    catch (e) { setData(bot); Alert.alert('Not changed', (e as Error).message); }
  };
  const c = bot.config;
  const services = Object.entries(c.mcpServers || {});
  return (
    <Screen onRefresh={refresh} refreshing={refreshing} stale={stale}>
      <Stack.Screen options={{ title: bot.name }} />
      <Card>
        <Spread>
          <Row style={{ flex: 1 }}><Led tone={bot.enabled ? 'ok' : 'off'} size={11} /><H2 style={{ flex: 1 }}>{bot.enabled ? 'On — answers in its chats' : 'Off — stays silent'}</H2></Row>
          <Toggle label="Agent on or off" value={bot.enabled} onChange={toggle} disabled={!admin} />
        </Spread>
        <Row wrap gap={8}><Label>{`${c.chats?.length || 0} chats`}</Label><Label>{`model ${c.model || 'auto'}`}</Label>{bot.updatedAt ? <Label>{`changed ${ago(bot.updatedAt)} ago`}</Label> : null}</Row>
        {bot.needs.length ? <Note tone="warn">{`Missing secret${bot.needs.length > 1 ? 's' : ''}: ${bot.needs.join(', ')}. Add ${bot.needs.length > 1 ? 'them' : 'it'} in the web panel → Secrets.`}</Note> : null}
        {admin ? <Button kind="primary" title="Change with AI" icon={<Icon name="ai" color={t.onPrimary} size={18} />} onPress={() => router.push({ pathname: '/ai/[id]', params: { id: bot.id } })}
          accessibilityHint="Describe a change in your own words; you see it before it is saved" /> : null}
      </Card>

      <Card>
        <H2>Basics</H2>
        {!admin ? <Note>Your account can look but not change. An admin can edit this.</Note> : null}
        <Field label="Name" value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} editable={admin} />
        <Field label="Description" value={form.description} onChangeText={(v) => setForm({ ...form, description: v })} editable={admin} />
        <Field label="Instructions" value={form.prompt} onChangeText={(v) => setForm({ ...form, prompt: v })} editable={admin} multiline
          hint="What the agent is for and how it should behave. Tool permissions are set by roles, not here." />
        <Field label="Triggers" value={form.triggers} onChangeText={(v) => setForm({ ...form, triggers: v })} editable={admin} autoCapitalize="none"
          hint={`Words that wake it in groups, comma-separated.${c.respondToMentions === false ? '' : ' It also answers when @mentioned.'}`} />
        {saved ? <Note tone="ok">{saved}</Note> : null}
        {admin ? <Button kind={dirty ? 'primary' : 'secondary'} title={dirty ? 'Save changes' : 'No changes'} disabled={!dirty} busy={saving} onPress={save} /> : null}
      </Card>

      <Card>
        <H2>Tools</H2>
        {services.length === 0 && !bot.localTools.length ? <Body muted>No tool services: it only talks.</Body> : null}
        {services.map(([name, s]) => (
          <View key={name} style={{ gap: 2 }}>
            <Row><Mono style={{ fontWeight: '600' }}>{name}</Mono><Pill>{s.type === 'local' ? 'on this server' : s.auth === 'oauth' ? 'sign-in' : 'token'}</Pill></Row>
            <Body small muted numberOfLines={1}>{s.type === 'local' ? s.package : (s.url || '').replace(/^https?:\/\//, '')}</Body>
          </View>
        ))}
        {bot.localTools.length ? <Body small muted>{`Plugin tools: ${bot.localTools.join(', ')}`}</Body> : null}
        <Divider />
        <Rules label="Participants may use" rules={c.tools?.participant} empty="nothing (they can only chat)" />
        <Rules label="Organizers may use" rules={c.tools?.organizer} empty="nothing" />
        {c.tools?.deny?.length ? <Rules label="Never" rules={c.tools.deny} empty="" /> : null}
        <Body small muted>Changes go through a confirmation step: an organizer in the chat, or you under Waiting for you.</Body>
      </Card>

      <Card>
        <H2>Roles</H2>
        <Label>Organizers</Label>
        <Body>{c.organizers?.length ? c.organizers.map((p) => `+${p.replace(/\D/g, '')}`).join(', ') : 'None set: WhatsApp group admins count as organizers.'}</Body>
        <Label>Direct messages</Label>
        <Body>{`From ${DM[c.dm || 'off'] || c.dm}`}</Body>
        <Label>Group memory</Label>
        <Body>{c.memory?.enabled ? 'On — it remembers decisions in its groups' : 'Off'}</Body>
      </Card>

      {c.schedules?.length ? (
        <Card>
          <H2>Scheduled posts</H2>
          {c.schedules.map((s) => (
            <View key={s.id} style={{ gap: 2 }}>
              <Row><Led tone={s.enabled ? 'ok' : 'off'} /><Mono>{`${s.at} · ${s.days || 'daily'}`}</Mono></Row>
              <Body small muted numberOfLines={2}>{s.prompt}</Body>
            </View>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}

function Rules({ label, rules, empty }: { label: string; rules?: string[]; empty: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Label>{label}</Label>
      {rules?.length ? <Row wrap gap={6}>{rules.map((r) => <Pill key={r}>{r}</Pill>)}</Row> : <Body small muted>{empty}</Body>}
    </View>
  );
}
