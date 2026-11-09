import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSmoothReady } from "../useSmoothReady";

describe("useSmoothReady", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns isReady immediately when data is already cached on mount", () => {
    const { result } = renderHook(() => useSmoothReady(false));

    expect(result.current).toEqual({
      isReady: true,
      showSkeleton: false,
      didWaitForData: false,
    });
  });

  it("skips skeleton when fast local data resolves before skeletonDelayMs", () => {
    const { result, rerender } = renderHook(
      ({ pending }) => useSmoothReady(pending, 220),
      { initialProps: { pending: true } }
    );

    expect(result.current).toEqual({
      isReady: false,
      showSkeleton: false,
      didWaitForData: true,
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current.showSkeleton).toBe(false);

    rerender({ pending: false });
    expect(result.current).toEqual({
      isReady: true,
      showSkeleton: false,
      didWaitForData: true,
    });
  });

  it("reveals skeleton after delay on slow loads and remains ready on subsequent refetches", () => {
    const { result, rerender } = renderHook(
      ({ pending }) => useSmoothReady(pending, 220),
      { initialProps: { pending: true } }
    );

    act(() => {
      vi.advanceTimersByTime(220);
    });
    expect(result.current).toEqual({
      isReady: false,
      showSkeleton: true,
      didWaitForData: true,
    });

    rerender({ pending: false });
    expect(result.current).toEqual({
      isReady: true,
      showSkeleton: false,
      didWaitForData: true,
    });

    // Subsequent in-page loading (e.g. changing filter/month) does not unmount content
    rerender({ pending: true });
    expect(result.current.isReady).toBe(true);
    expect(result.current.showSkeleton).toBe(false);
  });
});

