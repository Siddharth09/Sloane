/**
 * Lucy Labs mark: a microphone with a light waveform line across it (voice),
 * on a blue-to-purple gradient badge with a soft diagonal streak of yellow
 * for warmth - mixing the user's reference mic concept with our own colors.
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
      <defs>
        <linearGradient id="lucy-bg" x1="2" y1="2" x2="38" y2="38" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#6d84e0" />
          <stop offset="1" stopColor="#8b5fc9" />
        </linearGradient>
        <clipPath id="lucy-badge-clip">
          <rect width="40" height="40" rx="14" />
        </clipPath>
      </defs>

      <rect width="40" height="40" rx="14" fill="url(#lucy-bg)" />

      {/* Soft diagonal streak of yellow, clipped to the badge shape */}
      <g clipPath="url(#lucy-badge-clip)">
        <rect
          x="-4"
          y="4"
          width="50"
          height="9"
          rx="4.5"
          fill="#f4c84e"
          opacity="0.6"
          transform="rotate(-30 20 20)"
        />
      </g>

      {/* Mic capsule */}
      <rect x="14.5" y="7" width="11" height="17" rx="5.5" fill="#ffffff" />
      {/* Waveform line across the capsule */}
      <path
        d="M16.5 17 L18 12 L20 20 L22 11 L23.5 17"
        stroke="#8b5fc9"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.85"
      />
      {/* Stand + base */}
      <path
        d="M11.5 20a8.5 8.5 0 0 0 17 0"
        stroke="#ffffff"
        strokeWidth="2.3"
        strokeLinecap="round"
        fill="none"
      />
      <path d="M20 28.5V33" stroke="#ffffff" strokeWidth="2.3" strokeLinecap="round" />
      <rect x="15" y="33" width="10" height="2.4" rx="1.2" fill="#ffffff" />
    </svg>
  );
}
