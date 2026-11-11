import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "var(--color-background)",
        foreground: "var(--color-foreground)",
        card: {
          DEFAULT: "var(--color-card)",
          foreground: "var(--color-foreground)",
          contrast: "var(--color-card-contrast)",
        },
        border: "var(--color-border)",
        "control-border": "var(--color-control-border)",
        primary: {
          DEFAULT: "var(--color-primary)",
          foreground: "var(--color-primary-foreground)",
        },
        cta: {
          DEFAULT: "var(--color-cta-surface)",
          foreground: "var(--color-cta-foreground)",
        },
        dock: "var(--color-dock)",
        muted: {
          DEFAULT: "var(--color-muted)",
          foreground: "var(--color-muted-foreground)",
        },
      },
      fontFamily: {
        sans: [
          "Geist",
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "sans-serif",
        ],
        mono: [
          "Geist Mono",
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Consolas",
          "monospace",
        ],
      },
      boxShadow: {
        none: "none",
        DEFAULT: "none",
        sm: "none",
        md: "none",
        lg: "none",
        xl: "none",
        "2xl": "none",
        inner: "none",
      },
    },
  },
  plugins: [],
};

export default config;

