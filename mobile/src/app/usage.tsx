// Usage: totals for a period, by agent and by model (same numbers as the panel's Usage tab).
import { useState } from 'react';
import { View } from 'react-native';
import { Body, Card, Divider, H2, Label, Loading, Mono, Row, Screen, Segmented, Spread, Stat } from '@/components/ui';
import { compact, money, pct } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import type { Bot, UsageReport, UsageRow } from '@/lib/types';
import { useData } from '@/lib/useData';

type Period = '1d' | '7d' | '30d' | '90d';

export default function Usage() {
  const [period, setPeriod] = useState<Period>('30d');
  const byBot = useData<UsageReport>(`usage:bot:${period}`, (a) => a.get(`/api/usage?groupBy=bot&period=${period}`));
  const byModel = useData<UsageReport>(`usage:model:${period}`, (a) => a.get(`/api/usage?groupBy=model&period=${period}`));
  const bots = useData<Bot[]>('bots', (a) => a.get('/api/bots'));
  const tot = byBot.data?.total;
  const name = (k: string) => (k ? bots.data?.find((b) => b.id === k)?.name || k : 'Panel & AI helper');
  return (
    <Screen onRefresh={() => { byBot.refresh(); byModel.reload(); }} refreshing={byBot.refreshing} error={byBot.data ? null : byBot.error} stale={byBot.stale}>
      <Segmented label="Period" value={period} onChange={setPeriod} options={[{ value: '1d', label: 'Today' }, { value: '7d', label: '7 days' }, { value: '30d', label: '30 days' }, { value: '90d', label: '90 days' }]} />
      {!tot ? <Loading /> : (
        <>
          <Row wrap>
            <Stat label="Model calls" value={compact(tot.calls)} />
            <Stat label="Cost" value={money(tot.cost)} hint={tot.unpriced ? `${tot.unpriced} calls without a price` : undefined} />
          </Row>
          <Row wrap>
            <Stat label="Tokens in" value={compact(tot.input)} />
            <Stat label="Tokens out" value={compact(tot.output)} />
          </Row>
          <Breakdown title="By agent" rows={byBot.data!.rows} label={name} />
          {byModel.data ? <Breakdown title="By model" rows={byModel.data.rows} label={(k) => k.replace(/^[a-z-]+:/, '')} /> : null}
          <Body small muted style={{ textAlign: 'center' }}>Prices are set in the web panel (Usage) when a provider does not publish them.</Body>
        </>
      )}
    </Screen>
  );
}

function Breakdown({ title, rows, label }: { title: string; rows: UsageRow[]; label: (k: string) => string }) {
  const t = useTheme();
  const max = Math.max(1, ...rows.map((r) => r.input + r.output));
  return (
    <Card>
      <H2>{title}</H2>
      {rows.length === 0 ? <Body muted>No use in this period.</Body> : rows.map((r, i) => (
        <View key={r.key || '_'} style={{ gap: 5 }} accessible accessibilityLabel={`${label(r.key)}: ${r.calls} calls, ${compact(r.input + r.output)} tokens, ${money(r.cost)}`}>
          {i ? <Divider /> : null}
          <Spread><Body style={{ fontWeight: '600', flex: 1 }} numberOfLines={1}>{label(r.key)}</Body><Mono>{money(r.cost)}</Mono></Spread>
          <View style={{ height: 6, borderRadius: 6, backgroundColor: t.bg2 }}><View style={{ height: 6, borderRadius: 6, width: `${pct(r.input + r.output, max)}%`, backgroundColor: t.dark ? t.signal : t.ink }} /></View>
          <Label>{`${r.calls} calls · ${compact(r.input)} in · ${compact(r.output)} out`}</Label>
        </View>
      ))}
    </Card>
  );
}
