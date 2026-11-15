// The Duniya mark: a friendly robot in a solid green chat bubble (rounded square, tail at lower right). Same geometry
// as docs/site/img/logo.svg and logo() in the panel (src/panel/public/index.html). Fixed colours in both themes.
import Svg, { Circle, Path, Rect } from 'react-native-svg';

const INK = '#101216';
const GREEN = '#4d9b00';

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" accessibilityLabel="Duniya">
      <Path d="M23 5H41A17 17 0 0 1 58 22V44L59.5 59.5L44 55H23A17 17 0 0 1 6 38V22A17 17 0 0 1 23 5Z" fill={GREEN} stroke={GREEN} strokeWidth={4} strokeLinejoin="round" />
      <Rect x={11.8} y={28.3} width={9} height={13.4} rx={4} fill={INK} />
      <Rect x={43.2} y={28.3} width={9} height={13.4} rx={4} fill={INK} />
      <Circle cx={32} cy={12.6} r={2.8} fill={INK} />
      <Path d="M32 14.8v6.7" stroke={INK} strokeWidth={2.7} strokeLinecap="round" />
      <Rect x={18} y={21.5} width={28} height={27} rx={13} fill="#fff" stroke={INK} strokeWidth={2.7} />
      <Rect x={20.8} y={29.4} width={22.4} height={12.3} rx={6.15} fill={INK} />
      <Path d="M23.6 37.2a2.9 2.9 0 0 1 5.8 0M34.6 37.2a2.9 2.9 0 0 1 5.8 0" fill="none" stroke="#c6f432" strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}
