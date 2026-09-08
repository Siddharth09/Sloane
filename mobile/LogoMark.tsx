import { Image } from "react-native";

/**
 * Same mark as web/src/components/LogoMark.tsx: the user's glossy 3D mic
 * icon with sparkle accents, wordmark cropped out.
 */
export function LogoMark({ size = 56 }: { size?: number }) {
  const height = size;
  const width = Math.round(size * (431 / 423));
  return (
    <Image
      source={require("./assets/mic-logo.png")}
      style={{ width, height }}
      resizeMode="contain"
    />
  );
}
