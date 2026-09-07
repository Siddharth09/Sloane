/**
 * Lucy Labs mark: the user's mic icon (blue-to-purple gradient mic with a
 * light waveform line across the capsule), wordmark cropped out - used at
 * whatever size the caller needs.
 */
export function LogoMark({ size = 64 }: { size?: number }) {
  const height = size;
  const width = Math.round(size * (238 / 398));
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
