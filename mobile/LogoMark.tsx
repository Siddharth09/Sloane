import Svg, {
  ClipPath,
  Defs,
  LinearGradient,
  Path,
  Rect,
  Stop,
  G,
} from "react-native-svg";

/**
 * Same mark as web/src/components/LogoMark.tsx: a microphone with a light
 * waveform line across it, on a blue-to-purple gradient badge with a soft
 * diagonal streak of yellow for warmth.
 */
export function LogoMark({ size = 56 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40">
      <Defs>
        <LinearGradient id="lucy-bg" x1="2" y1="2" x2="38" y2="38" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#6d84e0" />
          <Stop offset="1" stopColor="#8b5fc9" />
        </LinearGradient>
        <ClipPath id="lucy-badge-clip">
          <Rect width="40" height="40" rx="14" />
        </ClipPath>
      </Defs>

      <Rect width="40" height="40" rx="14" fill="url(#lucy-bg)" />

      <G clipPath="url(#lucy-badge-clip)">
        <Rect
          x="-4"
          y="4"
          width="50"
          height="9"
          rx="4.5"
          fill="#f4c84e"
          opacity={0.6}
          transform="rotate(-30 20 20)"
        />
      </G>

      <Rect x="14.5" y="7" width="11" height="17" rx="5.5" fill="#ffffff" />
      <Path
        d="M16.5 17 L18 12 L20 20 L22 11 L23.5 17"
        stroke="#8b5fc9"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.85}
      />
      <Path
        d="M11.5 20a8.5 8.5 0 0 0 17 0"
        stroke="#ffffff"
        strokeWidth="2.3"
        strokeLinecap="round"
        fill="none"
      />
      <Path d="M20 28.5V33" stroke="#ffffff" strokeWidth="2.3" strokeLinecap="round" />
      <Rect x="15" y="33" width="10" height="2.4" rx="1.2" fill="#ffffff" />
    </Svg>
  );
}
