import * as React from "react";

export interface SmoothReadyState {
  /** True once initial data has finished loading (or was already cached on mount). */
  isReady: boolean;
  /** True only when initial loading exceeds skeletonDelayMs so fast local loads skip skeleton flicker. */
  showSkeleton: boolean;
  /** True if the component mounted while pending and waited before displaying content. */
  didWaitForData: boolean;
}

/**
 * Coordinates initial async data readiness so fast local/SQLite queries do not
 * flash empty states, "Rp 0", or brief skeleton placeholders before data arrives.
 */
export function useSmoothReady(
  isPending: boolean,
  skeletonDelayMs: number = 220
): SmoothReadyState {
  const [didWaitForData] = React.useState<boolean>(() => isPending);
  const [hasSettledOnce, setHasSettledOnce] = React.useState<boolean>(
    () => !isPending
  );
  const [showSkeleton, setShowSkeleton] = React.useState<boolean>(false);

  React.useEffect(() => {
    if (!isPending) {
      setHasSettledOnce(true);
      setShowSkeleton(false);
      return;
    }
    if (hasSettledOnce) {
      return;
    }
    const timer = window.setTimeout(() => {
      setShowSkeleton(true);
    }, skeletonDelayMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [isPending, hasSettledOnce, skeletonDelayMs]);

  return {
    isReady: hasSettledOnce || !isPending,
    showSkeleton: !hasSettledOnce && isPending && showSkeleton,
    didWaitForData,
  };
}

