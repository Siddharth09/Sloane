import { Image } from "react-native";

/**
 * Same mark as web/src/components/LogoMark.tsx: the user's mic icon
 * (blue-to-purple gradient mic with a light waveform line), wordmark
 * cropped out.
 */
export function LogoMark({ size = 56 }: { size?: number }) {
  const height = size;
  const width = Math.round(size * (238 / 398));
  return (
    <Image
      source={require("./assets/mic-logo.png")}
      style={{ width, height }}
      resizeMode="contain"
    />
  );
}
