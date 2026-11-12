import * as React from "react";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = React.useState<boolean>(() => {
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      return Boolean(window.matchMedia(query)?.matches);
    }
    return false;
  });

  React.useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(query);
    if (!media) return;
    const listener = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(Boolean(media.matches));
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", listener);
      return () => media.removeEventListener?.("change", listener);
    }
    media.addListener?.(listener);
    return () => media.removeListener?.(listener);
  }, [query]);

  return matches;
}
