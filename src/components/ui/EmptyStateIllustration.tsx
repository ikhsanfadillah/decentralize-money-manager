import * as React from "react";

export type EmptyStateVariant =
  | "monthly-history"
  | "recent-transactions"
  | "monthly-budget"
  | "transaction-filter"
  | "category-filter"
  | "active-budget-period";

export interface EmptyStateIllustrationProps {
  variant: EmptyStateVariant;
  className?: string;
}

/**
 * Adaptive SVG Illustrations for Empty States.
 * Automatically adapts to Light & Dark mode via CSS variables and Tailwind `dark:` classes.
 */
export const EmptyStateIllustration: React.FC<EmptyStateIllustrationProps> = ({
  variant,
  className = "mx-auto mb-2.5 h-20 w-24",
}) => {
  switch (variant) {
    case "monthly-history":
      return (
        <svg
          viewBox="0 0 120 96"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          data-testid="empty-illustration-monthly-history"
          className={className}
        >
          {/* Soft Ambient Glow */}
          <ellipse
            cx="60"
            cy="52"
            rx="44"
            ry="30"
            className="fill-emerald-500/8 dark:fill-emerald-500/12"
          />

          {/* Main Chart Card */}
          <rect
            x="18"
            y="16"
            width="84"
            height="62"
            rx="8"
            className="fill-background stroke-border dark:fill-zinc-950/90 dark:stroke-zinc-800"
            strokeWidth="1.5"
          />

          {/* Card Header Bar */}
          <line
            x1="18"
            y1="30"
            x2="102"
            y2="30"
            className="stroke-border dark:stroke-zinc-800"
            strokeWidth="1"
          />
          <circle
            cx="26"
            cy="23"
            r="2"
            className="fill-zinc-300 dark:fill-zinc-700"
          />
          <circle
            cx="33"
            cy="23"
            r="2"
            className="fill-zinc-300 dark:fill-zinc-700"
          />
          <rect
            x="40"
            y="21.5"
            width="24"
            height="3"
            rx="1.5"
            className="fill-zinc-200 dark:fill-zinc-800"
          />

          {/* Dashed Grid Lines */}
          <line
            x1="26"
            y1="44"
            x2="94"
            y2="44"
            className="stroke-zinc-200 dark:stroke-zinc-800/80"
            strokeWidth="1"
            strokeDasharray="2 2"
          />
          <line
            x1="26"
            y1="56"
            x2="94"
            y2="56"
            className="stroke-zinc-200 dark:stroke-zinc-800/80"
            strokeWidth="1"
            strokeDasharray="2 2"
          />

          {/* Monthly Bars (Placeholder & Emerald Accent) */}
          <rect
            x="30"
            y="54"
            width="8"
            height="14"
            rx="2"
            className="fill-zinc-200 dark:fill-zinc-800"
          />
          <rect
            x="45"
            y="46"
            width="8"
            height="22"
            rx="2"
            className="fill-emerald-500/25 dark:fill-emerald-500/30"
          />
          <rect
            x="60"
            y="50"
            width="8"
            height="18"
            rx="2"
            className="fill-zinc-200 dark:fill-zinc-800"
          />
          <rect
            x="75"
            y="39"
            width="8"
            height="29"
            rx="2"
            className="fill-emerald-500/60 dark:fill-emerald-400/60"
          />

          {/* Trend Line */}
          <path
            d="M34 50 L49 42 L64 46 L79 35"
            className="stroke-emerald-600 dark:stroke-emerald-400"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle
            cx="79"
            cy="35"
            r="3"
            className="fill-background stroke-emerald-600 dark:fill-zinc-900 dark:stroke-emerald-400"
            strokeWidth="2"
          />

          {/* Floating Calendar Badge */}
          <g transform="translate(80, 56)">
            <rect
              x="0"
              y="0"
              width="26"
              height="24"
              rx="6"
              className="fill-card stroke-border dark:fill-zinc-900 dark:stroke-zinc-700"
              strokeWidth="1.5"
            />
            <path
              d="M7 9H19M7 14H14"
              className="stroke-emerald-600 dark:stroke-emerald-400"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </g>
        </svg>
      );

    case "recent-transactions":
      return (
        <svg
          viewBox="0 0 120 96"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          data-testid="empty-illustration-recent-transactions"
          className={className}
        >
          {/* Ambient Backdrop */}
          <ellipse
            cx="60"
            cy="52"
            rx="44"
            ry="30"
            className="fill-emerald-500/8 dark:fill-emerald-500/12"
          />

          {/* Back Ledger Card */}
          <rect
            x="26"
            y="12"
            width="72"
            height="58"
            rx="7"
            className="fill-zinc-100 stroke-zinc-200 dark:fill-zinc-900/60 dark:stroke-zinc-800"
            strokeWidth="1.2"
          />

          {/* Front Receipt / Transaction Card */}
          <rect
            x="18"
            y="20"
            width="76"
            height="60"
            rx="8"
            className="fill-background stroke-border dark:fill-zinc-950/95 dark:stroke-zinc-800"
            strokeWidth="1.5"
          />

          {/* Row 1 */}
          <circle
            cx="30"
            cy="35"
            r="5"
            className="fill-emerald-500/20 dark:fill-emerald-500/25"
          />
          <rect
            x="40"
            y="31.5"
            width="28"
            height="3.5"
            rx="1.75"
            className="fill-zinc-300 dark:fill-zinc-700"
          />
          <rect
            x="40"
            y="37"
            width="18"
            height="2.5"
            rx="1.25"
            className="fill-zinc-200 dark:fill-zinc-800"
          />
          <rect
            x="74"
            y="33"
            width="12"
            height="4"
            rx="2"
            className="fill-emerald-500/40 dark:fill-emerald-400/40"
          />

          {/* Divider */}
          <line
            x1="25"
            y1="46"
            x2="86"
            y2="46"
            className="stroke-zinc-100 dark:stroke-zinc-800/80"
            strokeWidth="1"
          />

          {/* Row 2 */}
          <circle
            cx="30"
            cy="56"
            r="5"
            className="fill-zinc-200 dark:fill-zinc-800"
          />
          <rect
            x="40"
            y="52.5"
            width="32"
            height="3.5"
            rx="1.75"
            className="fill-zinc-300 dark:fill-zinc-700"
          />
          <rect
            x="40"
            y="58"
            width="20"
            height="2.5"
            rx="1.25"
            className="fill-zinc-200 dark:fill-zinc-800"
          />
          <rect
            x="74"
            y="54"
            width="12"
            height="4"
            rx="2"
            className="fill-zinc-200 dark:fill-zinc-800"
          />

          {/* Row 3 (Faded) */}
          <rect
            x="25"
            y="68"
            width="42"
            height="3"
            rx="1.5"
            className="fill-zinc-200/80 dark:fill-zinc-800/70"
          />

          {/* Plus Badge */}
          <g transform="translate(78, 56)">
            <circle
              cx="13"
              cy="13"
              r="13"
              className="fill-emerald-600 dark:fill-emerald-500"
            />
            <path
              d="M13 8V18M8 13H18"
              stroke="white"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
          </g>
        </svg>
      );

    case "monthly-budget":
      return (
        <svg
          viewBox="0 0 120 96"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          data-testid="empty-illustration-monthly-budget"
          className={className}
        >
          {/* Ambient Glow */}
          <ellipse
            cx="60"
            cy="50"
            rx="44"
            ry="30"
            className="fill-emerald-500/8 dark:fill-emerald-500/12"
          />

          {/* Budget Card Container */}
          <rect
            x="16"
            y="18"
            width="88"
            height="60"
            rx="8"
            className="fill-background stroke-border dark:fill-zinc-950/90 dark:stroke-zinc-800"
            strokeWidth="1.5"
          />

          {/* Budget Row 1 */}
          <rect
            x="26"
            y="28"
            width="30"
            height="3.5"
            rx="1.75"
            className="fill-zinc-300 dark:fill-zinc-700"
          />
          <rect
            x="76"
            y="28"
            width="18"
            height="3.5"
            rx="1.75"
            className="fill-emerald-500/50 dark:fill-emerald-400/50"
          />
          {/* Progress Track 1 */}
          <rect
            x="26"
            y="36"
            width="68"
            height="6"
            rx="3"
            className="fill-zinc-100 dark:fill-zinc-800"
          />
          <rect
            x="26"
            y="36"
            width="42"
            height="6"
            rx="3"
            className="fill-emerald-500 dark:fill-emerald-400"
          />

          {/* Budget Row 2 */}
          <rect
            x="26"
            y="50"
            width="24"
            height="3.5"
            rx="1.75"
            className="fill-zinc-300 dark:fill-zinc-700"
          />
          <rect
            x="78"
            y="50"
            width="16"
            height="3.5"
            rx="1.75"
            className="fill-zinc-200 dark:fill-zinc-800"
          />
          {/* Progress Track 2 */}
          <rect
            x="26"
            y="58"
            width="68"
            height="6"
            rx="3"
            className="fill-zinc-100 dark:fill-zinc-800"
          />
          <rect
            x="26"
            y="58"
            width="24"
            height="6"
            rx="3"
            className="fill-emerald-500/40 dark:fill-emerald-400/40"
          />

          {/* Target / Gauge Badge */}
          <g transform="translate(80, 54)">
            <circle
              cx="14"
              cy="14"
              r="13"
              className="fill-card stroke-border dark:fill-zinc-900 dark:stroke-zinc-700"
              strokeWidth="1.5"
            />
            <circle
              cx="14"
              cy="14"
              r="7.5"
              className="stroke-emerald-600 dark:stroke-emerald-400"
              strokeWidth="1.8"
              strokeDasharray="32 14"
            />
            <circle
              cx="14"
              cy="14"
              r="2.5"
              className="fill-emerald-600 dark:fill-emerald-400"
            />
          </g>
        </svg>
      );

    case "transaction-filter":
      return (
        <svg
          viewBox="0 0 120 96"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          data-testid="empty-illustration-transaction-filter"
          className={className}
        >
          {/* Ambient Glow */}
          <ellipse
            cx="60"
            cy="50"
            rx="44"
            ry="30"
            className="fill-emerald-500/8 dark:fill-emerald-500/12"
          />

          {/* List Card */}
          <rect
            x="18"
            y="16"
            width="74"
            height="60"
            rx="8"
            className="fill-background stroke-border dark:fill-zinc-950/90 dark:stroke-zinc-800"
            strokeWidth="1.5"
          />

          {/* Filter Pill Header */}
          <rect
            x="26"
            y="24"
            width="20"
            height="6"
            rx="3"
            className="fill-emerald-500/20 dark:fill-emerald-500/30"
          />
          <rect
            x="50"
            y="24"
            width="16"
            height="6"
            rx="3"
            className="fill-zinc-200 dark:fill-zinc-800"
          />
          <rect
            x="70"
            y="24"
            width="14"
            height="6"
            rx="3"
            className="fill-zinc-200 dark:fill-zinc-800"
          />

          {/* Dashed Empty Rows */}
          <rect
            x="26"
            y="38"
            width="58"
            height="10"
            rx="3"
            className="fill-zinc-100/80 stroke-zinc-200 dark:fill-zinc-900/70 dark:stroke-zinc-800"
            strokeWidth="1"
            strokeDasharray="3 2"
          />
          <rect
            x="26"
            y="54"
            width="46"
            height="10"
            rx="3"
            className="fill-zinc-100/80 stroke-zinc-200 dark:fill-zinc-900/70 dark:stroke-zinc-800"
            strokeWidth="1"
            strokeDasharray="3 2"
          />

          {/* Magnifying Glass / Search Filter Overlay */}
          <g transform="translate(66, 42)">
            <circle
              cx="16"
              cy="16"
              r="14"
              className="fill-card stroke-emerald-600 dark:fill-zinc-900 dark:stroke-emerald-400"
              strokeWidth="2.2"
            />
            <circle
              cx="16"
              cy="16"
              r="9"
              className="fill-emerald-500/10 dark:fill-emerald-400/15"
            />
            {/* Funnel inside lens */}
            <path
              d="M11 13H21L17.5 17V20L14.5 18.5V17L11 13Z"
              className="fill-emerald-600 dark:fill-emerald-400"
            />
            {/* Handle */}
            <line
              x1="26.5"
              y1="26.5"
              x2="34"
              y2="34"
              className="stroke-emerald-600 dark:stroke-emerald-400"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </g>
        </svg>
      );

    case "category-filter":
      return (
        <svg
          viewBox="0 0 120 96"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          data-testid="empty-illustration-category-filter"
          className={className}
        >
          {/* Ambient Glow */}
          <ellipse
            cx="60"
            cy="50"
            rx="44"
            ry="30"
            className="fill-emerald-500/8 dark:fill-emerald-500/12"
          />

          {/* Category Grid Cards */}
          <rect
            x="20"
            y="18"
            width="36"
            height="24"
            rx="6"
            className="fill-background stroke-border dark:fill-zinc-950/90 dark:stroke-zinc-800"
            strokeWidth="1.5"
          />
          <circle
            cx="30"
            cy="30"
            r="4"
            className="fill-emerald-500/30 dark:fill-emerald-400/30"
          />
          <rect
            x="38"
            y="28"
            width="12"
            height="4"
            rx="2"
            className="fill-zinc-300 dark:fill-zinc-700"
          />

          <rect
            x="62"
            y="18"
            width="36"
            height="24"
            rx="6"
            className="fill-background stroke-border dark:fill-zinc-950/90 dark:stroke-zinc-800"
            strokeWidth="1.5"
            strokeDasharray="3 2"
          />
          <circle
            cx="72"
            cy="30"
            r="4"
            className="fill-zinc-200 dark:fill-zinc-800"
          />
          <rect
            x="80"
            y="28"
            width="12"
            height="4"
            rx="2"
            className="fill-zinc-200 dark:fill-zinc-800"
          />

          <rect
            x="20"
            y="48"
            width="36"
            height="24"
            rx="6"
            className="fill-background stroke-border dark:fill-zinc-950/90 dark:stroke-zinc-800"
            strokeWidth="1.5"
            strokeDasharray="3 2"
          />
          <circle
            cx="30"
            cy="60"
            r="4"
            className="fill-zinc-200 dark:fill-zinc-800"
          />
          <rect
            x="38"
            y="58"
            width="12"
            height="4"
            rx="2"
            className="fill-zinc-200 dark:fill-zinc-800"
          />

          {/* Floating Tag Badge */}
          <g transform="translate(62, 44)">
            <rect
              x="0"
              y="0"
              width="38"
              height="30"
              rx="8"
              className="fill-card stroke-emerald-500/60 dark:fill-zinc-900 dark:stroke-emerald-400/60"
              strokeWidth="1.5"
            />
            <path
              d="M12 10H20L27 17L20 24L12 16V10Z"
              className="fill-emerald-500/20 stroke-emerald-600 dark:fill-emerald-400/20 dark:stroke-emerald-400"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <circle
              cx="16"
              cy="14"
              r="1.5"
              className="fill-emerald-600 dark:fill-emerald-400"
            />
          </g>
        </svg>
      );

    case "active-budget-period":
      return (
        <svg
          viewBox="0 0 120 96"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          data-testid="empty-illustration-active-budget-period"
          className={className}
        >
          {/* Ambient Glow */}
          <ellipse
            cx="60"
            cy="52"
            rx="44"
            ry="30"
            className="fill-emerald-500/8 dark:fill-emerald-500/12"
          />

          {/* Calendar Period Card */}
          <rect
            x="18"
            y="18"
            width="78"
            height="60"
            rx="8"
            className="fill-background stroke-border dark:fill-zinc-950/90 dark:stroke-zinc-800"
            strokeWidth="1.5"
          />

          {/* Calendar Rings */}
          <rect
            x="34"
            y="13"
            width="4"
            height="10"
            rx="2"
            className="fill-zinc-400 dark:fill-zinc-600"
          />
          <rect
            x="76"
            y="13"
            width="4"
            height="10"
            rx="2"
            className="fill-zinc-400 dark:fill-zinc-600"
          />

          {/* Calendar Header */}
          <line
            x1="18"
            y1="31"
            x2="96"
            y2="31"
            className="stroke-border dark:stroke-zinc-800"
            strokeWidth="1"
          />

          {/* Period Budget Sliders */}
          <line
            x1="28"
            y1="44"
            x2="76"
            y2="44"
            className="stroke-zinc-200 dark:stroke-zinc-800"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <line
            x1="28"
            y1="44"
            x2="54"
            y2="44"
            className="stroke-emerald-500 dark:stroke-emerald-400"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <circle
            cx="54"
            cy="44"
            r="4"
            className="fill-background stroke-emerald-600 dark:fill-zinc-900 dark:stroke-emerald-400"
            strokeWidth="2"
          />

          <line
            x1="28"
            y1="58"
            x2="76"
            y2="58"
            className="stroke-zinc-200 dark:stroke-zinc-800"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <line
            x1="28"
            y1="58"
            x2="42"
            y2="58"
            className="stroke-emerald-500/45 dark:stroke-emerald-400/45"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <circle
            cx="42"
            cy="58"
            r="4"
            className="fill-background stroke-emerald-500/70 dark:fill-zinc-900 dark:stroke-emerald-400/70"
            strokeWidth="2"
          />

          {/* Floating Pie/Dial Badge */}
          <g transform="translate(74, 48)">
            <circle
              cx="15"
              cy="15"
              r="14"
              className="fill-card stroke-border dark:fill-zinc-900 dark:stroke-zinc-700"
              strokeWidth="1.5"
            />
            <path
              d="M15 7V15H23A8 8 0 0 0 15 7Z"
              className="fill-emerald-500 dark:fill-emerald-400"
            />
            <circle
              cx="15"
              cy="15"
              r="8"
              className="stroke-emerald-600 dark:stroke-emerald-400"
              strokeWidth="1.6"
            />
          </g>
        </svg>
      );
  }
};

