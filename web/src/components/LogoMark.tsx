/**
 * Lucy Labs mark: a voice waveform with a soft, offset "echo" duplicate
 * behind it - representing both voice (the waveform) and cloning (the
 * echo), in soft rounded pill shapes rather than a literal microphone.
 */
export function LogoMark({ size = 64 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="40" height="40" rx="14" fill="url(#lucy-bg)" />

      {/* Echo layer - offset, softer, behind the main waveform */}
      <g opacity="0.45" transform="translate(3.5, 3)">
        <rect x="7" y="12" width="4" height="16" rx="2" fill="#ffffff" />
        <rect x="13" y="7" width="4" height="26" rx="2" fill="#ffffff" />
        <rect x="19" y="3" width="4" height="34" rx="2" fill="#ffffff" />
        <rect x="25" y="9" width="4" height="22" rx="2" fill="#ffffff" />
      </g>

      {/* Main waveform */}
      <g>
        <rect x="4" y="14" width="4" height="12" rx="2" fill="#ffffff" />
        <rect x="10" y="9" width="4" height="22" rx="2" fill="#ffffff" />
        <rect x="16" y="5" width="4" height="30" rx="2" fill="#ffffff" />
        <rect x="22" y="11" width="4" height="18" rx="2" fill="#ffffff" />
        <rect x="28" y="15" width="4" height="10" rx="2" fill="#ffffff" />
      </g>

      <defs>
        <linearGradient id="lucy-bg" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#e8a0a0" />
          <stop offset="1" stopColor="#e8846b" />
        </linearGradient>
      </defs>
    </svg>
  );
}
