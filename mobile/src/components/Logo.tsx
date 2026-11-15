// The Duniya mark: five people in a circle, each a different colour, around the world (ink dot). Same geometry as
// logo() in the panel (src/panel/public/index.html).
import Svg, { Circle, G, Path } from 'react-native-svg';
import { useTheme } from '@/lib/theme';

export function Logo({ size = 32, color }: { size?: number; color?: string }) {
  const t = useTheme();
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" accessibilityLabel="Duniya">
      <Circle cx={16} cy={16} r={3.1} fill={color || t.ink} />
      {t.people.map((c, i) => {
        const th = -90 + i * 72; const r = (th * Math.PI) / 180;
        return (
          <G key={c}>
            <Circle cx={16 + 12.2 * Math.cos(r)} cy={16 + 12.2 * Math.sin(r)} r={2.5} fill={c} />
            <G transform={`translate(${16 + 6.6 * Math.cos(r)} ${16 + 6.6 * Math.sin(r)}) rotate(${th + 90})`}>
              <Path d="M-3.7 2.2a3.7 3.7 0 0 1 7.4 0z" fill={c} />
            </G>
          </G>
        );
      })}
    </Svg>
  );
}
