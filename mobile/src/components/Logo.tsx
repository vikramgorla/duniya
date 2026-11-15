// The Duniya mark: a friendly robot in a chat bubble. Same geometry as docs/site/img/logo.svg and logo() in the
// panel (src/panel/public/index.html). Fixed colours in both themes: the white fill keeps it readable on dark.
import Svg, { Circle, Path, Rect } from 'react-native-svg';

const INK = '#101216';

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" accessibilityLabel="Duniya">
      <Path d="M24.6 52.6A23 23 0 1 0 12.6 42.5L7.6 57.4Z" fill="#fff" stroke="#1ea446" strokeWidth={4} strokeLinejoin="round" />
      <Rect x={14.5} y={29} width={8} height={12} rx={3.6} fill={INK} />
      <Rect x={42.5} y={29} width={8} height={12} rx={3.6} fill={INK} />
      <Circle cx={32.5} cy={15} r={2.5} fill={INK} />
      <Path d="M32.5 17v6" stroke={INK} strokeWidth={2.4} strokeLinecap="round" />
      <Rect x={20} y={23} width={25} height={24} rx={11.5} fill="#fff" stroke={INK} strokeWidth={2.4} />
      <Rect x={22.5} y={30} width={20} height={11} rx={5.5} fill={INK} />
      <Path d="M25 37a2.6 2.6 0 0 1 5.2 0M34.8 37a2.6 2.6 0 0 1 5.2 0" fill="none" stroke="#c6f432" strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}
