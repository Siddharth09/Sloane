import Svg, { Defs, LinearGradient, Rect, Stop, G } from "react-native-svg";

/**
 * Same mark as web/src/components/LogoMark.tsx: a voice waveform with a
 * soft offset "echo" duplicate behind it - voice + cloning, friendly rather
 * than a literal microphone.
 */
export function LogoMark({ size = 56 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40">
      <Defs>
        <LinearGradient id="lucy-bg" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#e8a0a0" />
          <Stop offset="1" stopColor="#e8846b" />
        </LinearGradient>
      </Defs>

      <Rect width="40" height="40" rx="14" fill="url(#lucy-bg)" />

      <G opacity={0.45} transform="translate(3.5, 3)">
        <Rect x="7" y="12" width="4" height="16" rx="2" fill="#ffffff" />
        <Rect x="13" y="7" width="4" height="26" rx="2" fill="#ffffff" />
        <Rect x="19" y="3" width="4" height="34" rx="2" fill="#ffffff" />
        <Rect x="25" y="9" width="4" height="22" rx="2" fill="#ffffff" />
      </G>

      <G>
        <Rect x="4" y="14" width="4" height="12" rx="2" fill="#ffffff" />
        <Rect x="10" y="9" width="4" height="22" rx="2" fill="#ffffff" />
        <Rect x="16" y="5" width="4" height="30" rx="2" fill="#ffffff" />
        <Rect x="22" y="11" width="4" height="18" rx="2" fill="#ffffff" />
        <Rect x="28" y="15" width="4" height="10" rx="2" fill="#ffffff" />
      </G>
    </Svg>
  );
}
