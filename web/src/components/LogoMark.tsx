/**
 * Lucy Labs mark: the user's glossy 3D mic icon with sparkle accents,
 * wordmark cropped out - used at whatever size the caller needs.
 */
export function LogoMark({ size = 64 }: { size?: number }) {
  const height = size;
  const width = Math.round(size * (422 / 420));
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/mic-logo.png"
      alt="Lucy Labs"
      width={width}
      height={height}
      style={{ width, height }}
    />
  );
}
