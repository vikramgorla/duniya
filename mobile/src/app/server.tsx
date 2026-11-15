// Server: health (CPU, memory, disk), and for owners the update status with "Update now" and progress that
// follows the restart (the server is briefly unreachable, then answers with the new version).
import { useRef, useState } from 'react';
import { ActivityIndicator, Alert } from 'react-native';
import { Body, Button, Card, H2, Label, Led, Loading, Meter, Note, Row, Screen, Spread, Stat } from '@/components/ui';
import { can, useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api-core';
import { ago, bytes, duration, pct } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import type { SystemSnapshot, UpdateInfo } from '@/lib/types';
import { useData } from '@/lib/useData';

export default function Server() {
  const { user } = useAuth();
  const sys = useData<SystemSnapshot>('system', (a) => a.get('/api/system'), { interval: 10_000 });
  const s = sys.data;
  return (
    <Screen onRefresh={sys.refresh} refreshing={sys.refreshing} error={s ? null : sys.error} stale={sys.stale}>
      {can(user, 'owner') ? <Updates /> : <Note>Updates and restarts are for the owner. Ask them, or look in the web panel.</Note>}
      {!s ? <Loading /> : (
        <>
          <Card>
            <H2>{s.host}</H2>
            <Row wrap gap={8}><Label>{s.os}</Label><Label>{`${s.cpus} CPU`}</Label><Label>{`up ${duration(s.uptimeSec)}`}</Label></Row>
            {s.cpu != null ? <Meter label="CPU" value={s.cpu} detail={`load ${s.load[0]}`} /> : null}
            <Meter label="Memory" value={pct(s.memory.used, s.memory.total)} detail={`${bytes(s.memory.used)} of ${bytes(s.memory.total)}`} />
            {s.memory.swapTotal ? <Meter label="Swap" value={pct(s.memory.swapUsed, s.memory.swapTotal)} detail={bytes(s.memory.swapUsed)} /> : null}
            {s.disks.map((d) => <Meter key={d.path} label={`Disk ${d.path}`} value={pct(d.used, d.total)} detail={`${bytes(d.free)} free`} />)}
            {s.rebootRequired ? <Note tone="warn">The system wants a restart after OS updates. Do it from the web panel → Server.</Note> : null}
          </Card>
          <Row wrap><Stat label="Duniya memory" value={bytes(s.app.rss)} /><Stat label="Node" value={s.app.node} /></Row>
        </>
      )}
    </Screen>
  );
}

function Updates() {
  const t = useTheme();
  const { api } = useAuth();
  // Follow an update to its end: running → (server restarts, unreachable) → answers again with a new version.
  const [phase, setPhaseState] = useState<'idle' | 'following' | 'restarting'>('idle');
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);
  const track = useRef({ phase: 'idle', from: '' });
  const setPhase = (p: 'idle' | 'following' | 'restarting') => { track.current.phase = p; setPhaseState(p); };
  const up = useData<UpdateInfo>('updates', async (a) => {
    try {
      const r = await a.get<UpdateInfo>('/api/updates');
      if (r.running) {
        if (track.current.phase === 'idle') track.current.from = r.status?.current || '';
        setPhase('following');
      } else if (track.current.phase !== 'idle') {
        setPhase('idle');
        const now = r.status?.current || '';
        setDone(now && now !== track.current.from ? `Updated to ${now}. Agents are back.` : 'The update finished. If the version did not change, see the web panel → Server → log.');
      }
      return r;
    } catch (e) {
      if (track.current.phase !== 'idle' && (e as ApiError).status === 0) setPhase('restarting');
      throw e;
    }
  }, { interval: phase === 'idle' ? 0 : 3000 });
  const u = up.data;
  const following = phase !== 'idle';
  const restarting = phase === 'restarting';

  const apply = () => {
    const target = u?.status?.latest || 'the new version';
    Alert.alert(`Update to ${target}?`, 'Agents are offline for 1–2 minutes while Duniya installs and restarts. All data is kept.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Update now', onPress: async () => {
        setBusy(true); setDone('');
        try { track.current.from = u?.status?.current || ''; await api!.post('/api/updates/apply'); setPhase('following'); up.reload(); }
        catch (e) { Alert.alert('Update not started', (e as Error).message); } finally { setBusy(false); }
      } },
    ]);
  };
  const check = async () => { setBusy(true); try { await api!.post('/api/updates/check'); up.reload(); } catch (e) { Alert.alert('Check failed', (e as Error).message); } finally { setBusy(false); } };

  if (!u) return <Card><H2>Updates</H2>{up.error ? <Note tone="bad">{up.error}</Note> : <Loading />}</Card>;
  const st = u.status;
  const running = u.running || (following && restarting);
  return (
    <Card>
      <Spread><H2>Updates</H2><Label>{`mode ${u.settings.mode}`}</Label></Spread>
      {running ? (
        <Row><ActivityIndicator color={t.ink} />
          <Body style={{ flex: 1, fontWeight: '600' }}>{restarting ? 'Restarting… waiting for the server to answer' : `Installing ${u.running?.target || ''}… started ${ago(u.running?.startedAt)} ago`}</Body></Row>
      ) : st?.available ? (
        <Row><Led tone="warn" /><Body style={{ flex: 1, fontWeight: '600' }}>{`Update available: ${st.latest} · running ${st.current}`}</Body></Row>
      ) : (
        <Row><Led tone="ok" /><Body style={{ flex: 1, fontWeight: '600' }}>{`Up to date: ${st?.current || '—'}`}{st?.checkedAt ? <Body small muted>{` · checked ${ago(st.checkedAt)} ago`}</Body> : null}</Body></Row>
      )}
      {done ? <Note tone="ok">{done}</Note> : null}
      {u.install === 'docker' ? <Note>Docker install: update with docker compose pull &amp;&amp; docker compose up -d on the server.</Note>
        : running ? <Body small muted>You can leave this screen; the update continues on the server.</Body>
          : st?.available ? <Button kind="primary" title={`Update to ${st.latest}`} busy={busy} onPress={apply} />
            : <Button title="Check now" busy={busy} onPress={check} />}
    </Card>
  );
}
