import * as React from "react";

/**
 * Vector illustration for book delete confirmation bottom drawer.
 * Matches the crimson warning visual language used across confirmation drawers.
 */
export const DeleteBookIllustration: React.FC<{ className?: string }> = ({
  className = "w-24 h-24 mx-auto",
}) => (
  <svg
    viewBox="0 0 120 120"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    role="img"
    aria-label="Konfirmasi Hapus Buku"
  >
    <defs>
      <radialGradient id="deleteBookGlow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.18" />
        <stop offset="100%" stopColor="#f43f5e" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="deleteBookCoverGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#ffffff" />
        <stop offset="100%" stopColor="#f1f5f9" />
      </linearGradient>
      <linearGradient id="deleteBookBinGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#f43f5e" />
        <stop offset="100%" stopColor="#e11d48" />
      </linearGradient>
    </defs>

    {/* Ambient halo */}
    <circle cx="60" cy="60" r="54" fill="url(#deleteBookGlow)" />
    <circle
      cx="60"
      cy="60"
      r="44"
      fill="rgba(244, 63, 94, 0.06)"
      stroke="rgba(244, 63, 94, 0.15)"
      strokeWidth="1.5"
      strokeDasharray="4 4"
    />

    {/* Tilted Ledger Book (Left) */}
    <g transform="rotate(-10 43 49)">
      <rect
        x="24"
        y="22"
        width="36"
        height="48"
        rx="5"
        fill="url(#deleteBookCoverGrad)"
        stroke="#cbd5e1"
        strokeWidth="1.5"
      />
      {/* Book spine */}
      <rect
        x="24"
        y="22"
        width="8"
        height="48"
        rx="3"
        fill="#f43f5e"
        fillOpacity="0.85"
      />
      {/* Book label lines */}
      <rect x="36" y="31" width="18" height="3.5" rx="1.75" fill="#f43f5e" />
      <rect x="36" y="39" width="16" height="2" rx="1" fill="#94a3b8" />
      <rect x="36" y="45" width="13" height="2" rx="1" fill="#cbd5e1" />
      <rect x="36" y="54" width="18" height="2.5" rx="1.25" fill="#fda4af" />
    </g>

    {/* Crimson Trash Bin (Right) */}
    <g>
      <path
        d="M 58 56 L 62 92 Q 62 96 66 96 L 86 96 Q 90 96 90 92 L 94 56 Z"
        fill="url(#deleteBookBinGrad)"
        stroke="#be123c"
        strokeWidth="1.5"
      />
      <line
        x1="68"
        y1="65"
        x2="70"
        y2="88"
        stroke="#ffffff"
        strokeOpacity="0.4"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="76"
        y1="65"
        x2="76"
        y2="88"
        stroke="#ffffff"
        strokeOpacity="0.4"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="84"
        y1="65"
        x2="82"
        y2="88"
        stroke="#ffffff"
        strokeOpacity="0.4"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <rect
        x="55"
        y="53"
        width="42"
        height="5"
        rx="2.5"
        fill="#e11d48"
        stroke="#be123c"
        strokeWidth="1.5"
      />
      <g transform="rotate(-18 76 50)">
        <rect
          x="54"
          y="47"
          width="44"
          height="4.5"
          rx="2"
          fill="#f43f5e"
          stroke="#be123c"
          strokeWidth="1.5"
        />
        <path
          d="M 70 47 Q 70 42 76 42 Q 82 42 82 47"
          fill="none"
          stroke="#be123c"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </g>
    </g>

    {/* Floating Coin (Gold Rp) */}
    <g transform="translate(18, 70)">
      <circle
        cx="8"
        cy="8"
        r="8"
        fill="#fbbf24"
        stroke="#d97706"
        strokeWidth="1.2"
      />
      <circle cx="8" cy="8" r="6" fill="#fde68a" />
      <text
        x="8"
        y="11"
        textAnchor="middle"
        fontSize="7.5"
        fontFamily="monospace"
        fontWeight="bold"
        fill="#b45309"
      >
        Rp
      </text>
    </g>

    {/* Sparkles */}
    <path
      d="M 98 26 Q 98 32 104 32 Q 98 32 98 38 Q 98 32 92 32 Q 98 32 98 26 Z"
      fill="#f43f5e"
    />
    <path
      d="M 22 46 Q 22 50 26 50 Q 22 50 22 54 Q 22 50 18 50 Q 22 50 22 46 Z"
      fill="#f59e0b"
    />
    <circle cx="88" cy="40" r="1.5" fill="#f43f5e" />
    <circle cx="36" cy="18" r="1.5" fill="#f59e0b" />
    <circle cx="102" cy="74" r="2" fill="#fda4af" />
  </svg>
);

