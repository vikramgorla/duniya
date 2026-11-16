// Constellation building blocks for native screens (DESIGN.md → Components): card, stat tile, meter, pill, note,
// LED, segmented control, toggle, buttons, fields. Native components only; no web view.
import { useNetInfo } from '@react-native-community/netinfo';
import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import {
  ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View,
  type StyleProp, type TextInputProps, type TextStyle, type ViewStyle,
} from 'react-native';
import { useTheme, type Theme } from '@/lib/theme';
import type { Tone } from '@/lib/status';

export type NoteTone = 'ok' | 'warn' | 'bad' | 'info';

// ---------- text ----------
export function Title({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const t = useTheme();
  return <Text accessibilityRole="header" style={[{ color: t.ink, fontSize: 24, fontWeight: '700', letterSpacing: -0.5 }, style]}>{children}</Text>;
}
export function H2({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const t = useTheme();
  return <Text accessibilityRole="header" style={[{ color: t.ink, fontSize: 17, fontWeight: '650' as TextStyle['fontWeight'], letterSpacing: -0.3 }, style]}>{children}</Text>;
}
export function Body({ children, muted, small, style, numberOfLines, selectable }: { children: ReactNode; muted?: boolean; small?: boolean; style?: StyleProp<TextStyle>; numberOfLines?: number; selectable?: boolean }) {
  const t = useTheme();
  return <Text selectable={selectable} numberOfLines={numberOfLines} style={[{ color: muted ? t.muted : t.ink, fontSize: small ? 13 : 15, lineHeight: small ? 18 : 21 }, style]}>{children}</Text>;
}
/** Instrument label: monospace, uppercase, wide tracking. */
export function Label({ children, style, color }: { children: ReactNode; style?: StyleProp<TextStyle>; color?: string }) {
  const t = useTheme();
  return <Text style={[{ color: color || t.muted, fontFamily: t.mono, fontSize: 11, letterSpacing: 1.3, textTransform: 'uppercase', fontWeight: '600' }, style]}>{children}</Text>;
}
export function Mono({ children, style, size = 13 }: { children: ReactNode; style?: StyleProp<TextStyle>; size?: number }) {
  const t = useTheme();
  return <Text style={[{ color: t.ink, fontFamily: t.mono, fontSize: size }, style]}>{children}</Text>;
}

// ---------- surfaces ----------
export function Card({ children, style, onPress, accessibilityLabel }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; accessibilityLabel?: string }) {
  const t = useTheme();
  const base: ViewStyle = { backgroundColor: t.card, borderColor: t.line, borderWidth: StyleSheet.hairlineWidth * 2, borderRadius: t.radius, padding: 16, gap: 10, ...shadow(t) };
  if (!onPress) return <View style={[base, style]}>{children}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress}
      style={({ pressed }) => [base, style, pressed && { transform: [{ scale: 0.985 }], borderColor: t.line2 }]}>
      {children}
    </Pressable>
  );
}
const shadow = (t: Theme): ViewStyle => (t.dark ? {} : Platform.select<ViewStyle>({
  ios: { shadowColor: '#101216', shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } },
  android: { elevation: 1 },
  default: { boxShadow: '0 1px 2px rgba(16,18,22,.04), 0 10px 30px -18px rgba(16,18,22,.25)' } as ViewStyle,
}) || {});

export function Row({ children, style, gap = 10, wrap }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number; wrap?: boolean }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap, flexWrap: wrap ? 'wrap' : 'nowrap' }, style]}>{children}</View>;
}
export function Spread({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, style]}>{children}</View>;
}
export function Divider() {
  const t = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth * 2, backgroundColor: t.line, marginVertical: 2 }} />;
}

// ---------- status ----------
/** LED with a glow for live state. tone 'off' = grey. */
export function Led({ tone, size = 9 }: { tone: Tone; size?: number }) {
  const t = useTheme();
  const c = t.led[tone];
  return (
    <View accessibilityElementsHidden style={{ width: size, height: size, borderRadius: size, backgroundColor: c,
      ...(tone === 'off' ? {} : Platform.select<ViewStyle>({ ios: { shadowColor: c, shadowOpacity: 0.9, shadowRadius: 5, shadowOffset: { width: 0, height: 0 } }, android: {}, default: { boxShadow: `0 0 8px ${c}` } as ViewStyle })) }} />
  );
}
export function LedLabel({ tone, label, value }: { tone: Tone; label: string; value: string }) {
  return (
    <View style={{ gap: 4, flex: 1, minWidth: 90 }} accessible accessibilityLabel={`${label}: ${value}`}>
      <Row gap={7}><Led tone={tone} /><Label>{label}</Label></Row>
      <Mono size={15} style={{ fontWeight: '600' }}>{value}</Mono>
    </View>
  );
}
export function Pill({ children, tone }: { children: ReactNode; tone?: NoteTone | 'plain' }) {
  const t = useTheme();
  const [bg, fg] = tone && tone !== 'plain' ? [t[`${tone}Soft`], t[tone]] : [t.bg2, t.ink];
  return (
    <View style={{ backgroundColor: bg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' }}>
      <Text style={{ color: fg, fontFamily: t.mono, fontSize: 11, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase' }}>{children}</Text>
    </View>
  );
}
/** Soft tinted note with a left rule. */
export function Note({ children, tone = 'info', title }: { children: ReactNode; tone?: NoteTone; title?: string }) {
  const t = useTheme();
  return (
    <View accessibilityRole={tone === 'bad' ? 'alert' : undefined} style={{ backgroundColor: t[`${tone}Soft`], borderLeftWidth: 3, borderLeftColor: t[tone], borderRadius: t.radiusS, padding: 12, gap: 4 }}>
      {title ? <Text style={{ color: t[tone], fontWeight: '700', fontSize: 14 }}>{title}</Text> : null}
      {typeof children === 'string' ? <Text style={{ color: t[tone], fontSize: 14, lineHeight: 19 }}>{children}</Text> : children}
    </View>
  );
}
/** Stat tile: mono label + big mono figure. */
export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, minWidth: 130, backgroundColor: t.card, borderColor: t.line, borderWidth: StyleSheet.hairlineWidth * 2, borderRadius: t.radius, padding: 14, gap: 6 }}
      accessible accessibilityLabel={`${label}: ${value}${hint ? `, ${hint}` : ''}`}>
      <Label>{label}</Label>
      <Text style={{ color: t.ink, fontFamily: t.mono, fontSize: 24, fontWeight: '600', letterSpacing: -0.5 }}>{value}</Text>
      {hint ? <Body small muted>{hint}</Body> : null}
    </View>
  );
}
export function Meter({ value, label, detail }: { value: number; label: string; detail?: string }) {
  const t = useTheme();
  const v = Math.max(0, Math.min(100, value || 0));
  const tone = v > 90 ? t.bad : v > 75 ? t.warn : t.dark ? t.signal : t.ink;
  return (
    <View style={{ gap: 6 }} accessible accessibilityLabel={`${label} ${Math.round(v)} percent${detail ? `, ${detail}` : ''}`}>
      <Spread><Label>{label}</Label><Mono size={12}>{`${Math.round(v)}%${detail ? ` · ${detail}` : ''}`}</Mono></Spread>
      <View style={{ height: 6, borderRadius: 6, backgroundColor: t.bg2, overflow: 'hidden' }}>
        <View style={{ width: `${v}%`, height: 6, borderRadius: 6, backgroundColor: tone }} />
      </View>
    </View>
  );
}

// ---------- controls ----------
export function Button({ title, onPress, kind = 'secondary', disabled, busy, small, icon, accessibilityHint, style }: {
  title: string; onPress?: () => void; kind?: 'primary' | 'secondary' | 'danger' | 'ghost'; disabled?: boolean; busy?: boolean; small?: boolean; icon?: ReactNode; accessibilityHint?: string; style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const colors = {
    primary: { bg: t.primary, fg: t.onPrimary, border: t.primary },
    secondary: { bg: t.card, fg: t.ink, border: t.line2 },
    danger: { bg: t.card, fg: t.bad, border: t.bad },
    ghost: { bg: 'transparent', fg: t.ink, border: 'transparent' },
  }[kind];
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityHint={accessibilityHint} accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
      disabled={disabled || busy}
      onPress={() => { if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {}); onPress?.(); }}
      style={({ pressed }) => [{
        minHeight: small ? 36 : 46, paddingHorizontal: small ? 12 : 18, borderRadius: t.radiusS, borderWidth: 1,
        backgroundColor: colors.bg, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
        opacity: disabled ? 0.45 : 1, transform: [{ scale: pressed ? 0.97 : 1 }],
      }, style]}>
      {busy ? <ActivityIndicator color={colors.fg} size="small" /> : icon}
      <Text style={{ color: colors.fg, fontWeight: '600', fontSize: small ? 14 : 16 }}>{title}</Text>
    </Pressable>
  );
}
export function Toggle({ value, onChange, disabled, label }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  const t = useTheme();
  return (
    <Switch accessibilityLabel={label} value={value} disabled={disabled} onValueChange={onChange}
      trackColor={{ false: t.line2, true: t.dark ? t.signal : t.ink }} thumbColor={value ? (t.dark ? t.ink : t.signal) : '#ffffff'}
      ios_backgroundColor={t.line2} {...(Platform.OS === 'web' ? { activeThumbColor: t.dark ? t.ink : t.signal, activeTrackColor: t.dark ? t.signal : t.ink } : {})} />
  );
}
export function Segmented<T extends string>({ options, value, onChange, label }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  const t = useTheme();
  return (
    <View accessibilityRole="tablist" accessibilityLabel={label} style={{ flexDirection: 'row', backgroundColor: t.bg2, borderRadius: t.radiusS, padding: 3, gap: 3 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => onChange(o.value)}
            style={{ flex: 1, minHeight: 34, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? t.card : 'transparent', paddingHorizontal: 6 }}>
            <Text numberOfLines={1} style={{ color: on ? t.ink : t.muted, fontFamily: t.mono, fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6 }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
export function Field({ label, hint, style, ...props }: TextInputProps & { label: string; hint?: string }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Label>{label}</Label>
      <TextInput accessibilityLabel={label} placeholderTextColor={t.muted} {...props}
        style={[{ color: t.ink, backgroundColor: t.card, borderColor: t.line2, borderWidth: 1, borderRadius: t.radiusS, paddingHorizontal: 12, paddingVertical: 11, fontSize: 16, minHeight: 46 }, props.multiline && { minHeight: 140, textAlignVertical: 'top' }, style]} />
      {hint ? <Body small muted>{hint}</Body> : null}
    </View>
  );
}
/** A tappable list row (chats, agents, menu). */
export function ListRow({ title, subtitle, right, onPress, left }: { title: string; subtitle?: string; right?: ReactNode; left?: ReactNode; onPress?: () => void }) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title} onPress={onPress} disabled={!onPress}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, minHeight: 52 }, pressed && { opacity: 0.6 }]}>
      {left}
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1} style={{ color: t.ink, fontSize: 16, fontWeight: '600' }}>{title}</Text>
        {subtitle ? <Text numberOfLines={2} style={{ color: t.muted, fontSize: 13 }}>{subtitle}</Text> : null}
      </View>
      {right}
      {onPress ? <Text style={{ color: t.muted, fontSize: 20 }}>›</Text> : null}
    </Pressable>
  );
}

// ---------- screens ----------
/** Scrollable screen with pull-to-refresh, the dot-grid ground and the offline banner. */
export function Screen({ children, onRefresh, refreshing = false, error, stale }: {
  children: ReactNode; onRefresh?: () => void; refreshing?: boolean; error?: string | null; stale?: boolean;
}) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <OfflineBanner stale={stale} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48, maxWidth: 820, width: '100%', alignSelf: 'center' }}
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.muted} colors={[t.ink]} /> : undefined}>
        {error ? <Note tone="bad">{error}</Note> : null}
        {children}
      </ScrollView>
    </View>
  );
}
function OfflineBanner({ stale }: { stale?: boolean }) {
  const t = useTheme();
  const net = useNetInfo();
  const offline = net.isConnected === false;
  if (!offline && !stale) return null;
  return (
    <View accessibilityRole="alert" style={{ backgroundColor: t.warnSoft, paddingVertical: 8, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Led tone="warn" size={7} />
      <Text style={{ color: t.warn, fontSize: 13, fontWeight: '600', flex: 1 }}>
        {offline ? 'You are offline — showing what was loaded last.' : 'The server is not answering — showing what was loaded last.'}
      </Text>
    </View>
  );
}
export function Loading({ label = 'Loading…' }: { label?: string }) {
  const t = useTheme();
  return <Row style={{ padding: 24, justifyContent: 'center' }}><ActivityIndicator color={t.muted} /><Body muted>{label}</Body></Row>;
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <Card style={{ alignItems: 'flex-start' }}><H2>{title}</H2>{children ? <Body muted>{children}</Body> : null}</Card>;
}
