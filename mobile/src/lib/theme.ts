// Constellation design tokens for the app (DESIGN.md): porcelain + ink, one lime signal, mono labels, LED status.
import { Platform, useColorScheme } from 'react-native';

const shared = {
  signal: '#c6f432',
  radius: 16,
  radiusS: 10,
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, "SF Mono", Menlo, monospace' }),
};

export const light = {
  ...shared, dark: false,
  bg: '#f2f1ec', bg2: '#e8e6df', card: '#ffffff', ink: '#101216', muted: '#5f636c', line: '#e2e0d8', line2: '#cfccc2',
  primary: '#101216', onPrimary: '#ffffff', grid: 'rgba(16,18,22,0.075)',
  ok: '#3f6b00', okSoft: '#e9f7c4', warn: '#9a4b00', warnSoft: '#ffeedd', bad: '#c42443', badSoft: '#ffe6ea', info: '#2c4fd6', infoSoft: '#e8edff',
  led: { ok: '#8fd400', warn: '#ff9a3d', bad: '#ff3b5c', off: '#b9b6ad' },
};
export const dark: typeof light = {
  ...shared, dark: true,
  bg: '#0b0c0f', bg2: '#15171c', card: '#121419', ink: '#eceef2', muted: '#9196a1', line: '#23262e', line2: '#343844',
  primary: '#c6f432', onPrimary: '#101216', grid: 'rgba(255,255,255,0.07)',
  ok: '#c6f432', okSoft: 'rgba(198,244,50,0.12)', warn: '#ffb36b', warnSoft: 'rgba(255,150,70,0.13)', bad: '#ff7d93', badSoft: 'rgba(255,80,110,0.13)', info: '#9fb2ff', infoSoft: 'rgba(110,140,255,0.14)',
  led: { ok: '#c6f432', warn: '#ffb36b', bad: '#ff5c78', off: '#4a4e58' },
};
export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}
