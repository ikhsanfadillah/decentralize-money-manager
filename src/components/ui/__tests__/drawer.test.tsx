import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  DRAWER_DESKTOP_MEDIA_QUERY,
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerNested,
  DrawerTitle,
  useDrawerDirection,
} from "../drawer";
import { CurrencyInput } from "../currency-input";
import { TransactionDialog } from "../../transactions/TransactionDialog";
import {
  tauriApi,
  type AccountView,
  type CategoryView,
} from "../../../lib/tauri-api";

interface MockVisualViewport extends EventTarget {
  width: number;
  height: number;
  offsetTop: number;
  offsetLeft: number;
  pageTop: number;
  pageLeft: number;
  scale: number;
}

function createMockVisualViewport(
  initialHeight: number,
  initialScale = 1
): MockVisualViewport {
  const target = new EventTarget() as MockVisualViewport;
  target.width = 390;
  target.height = initialHeight;
  target.offsetTop = 0;
  target.offsetLeft = 0;
  target.pageTop = 0;
  target.pageLeft = 0;
  target.scale = initialScale;
  return target;
}

describe("Drawer mobile keyboard viewport handling", () => {
  const originalInnerHeight = window.innerHeight;
  const originalVisualViewport = window.visualViewport;
  let mockVv: MockVisualViewport;

  const setViewport = (opts: {
    innerHeight?: number;
    vvHeight?: number;
    offsetTop?: number;
    scale?: number;
    fireVvResize?: boolean;
    fireWindowResize?: boolean;
  }) => {
    if (opts.innerHeight !== undefined) {
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        writable: true,
        value: opts.innerHeight,
      });
    }
    if (opts.vvHeight !== undefined) {
      mockVv.height = opts.vvHeight;
    }
    if (opts.offsetTop !== undefined) {
      mockVv.offsetTop = opts.offsetTop;
    }
    if (opts.scale !== undefined) {
      mockVv.scale = opts.scale;
    }
    if (opts.fireVvResize) {
      mockVv.dispatchEvent(new Event("resize"));
    }
    if (opts.fireWindowResize) {
      window.dispatchEvent(new Event("resize"));
    }
  };

  const flushRaf = async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 35));
    });
  };

  beforeEach(() => {
    mockVv = createMockVisualViewport(800, 1);
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: 800,
    });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      writable: true,
      value: mockVv,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: originalInnerHeight,
    });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      writable: true,
      value: originalVisualViewport,
    });
  });

  it("never locks inline style.height under interactive-widget=resizes-content when keyboard opens and closes", async () => {
    render(
      <Drawer open={true} onOpenChange={vi.fn()}>
        <DrawerContent className="h-[92dvh] max-h-[92dvh]">
          <DrawerTitle>Test Drawer</DrawerTitle>
          <DrawerDescription>Desc</DrawerDescription>
          <input aria-label="Nota" />
        </DrawerContent>
      </Drawer>
    );

    const dialog = screen.getByRole("dialog");
    const input = screen.getByLabelText("Nota");

    // Mock dynamic layout height reflecting 92dvh at current innerHeight
    vi.spyOn(dialog, "getBoundingClientRect").mockImplementation(() => {
      const h = Math.round(window.innerHeight * 0.92);
      return {
        x: 0,
        y: window.innerHeight - h,
        width: 390,
        height: h,
        top: window.innerHeight - h,
        right: 390,
        bottom: window.innerHeight,
        left: 0,
        toJSON: () => ({}),
      } as DOMRect;
    });

    // 1. Tap input & open keyboard (Android resizes-content shrinks both innerHeight & visualViewport.height)
    act(() => {
      input.focus();
      setViewport({
        innerHeight: 450,
        vvHeight: 450,
        fireVvResize: true,
        fireWindowResize: true,
      });
    });
    await flushRaf();

    expect(dialog.style.height).toBe("");
    expect(dialog.style.maxHeight).toBe("");
    expect(dialog.style.bottom).toBe("");

    // 2. Close keyboard (input may stay focused or blur; viewport returns to 800px)
    act(() => {
      input.blur();
      setViewport({
        innerHeight: 800,
        vvHeight: 800,
        fireVvResize: true,
        fireWindowResize: true,
      });
    });
    await flushRaf();

    // Must never retain a stale shrunk inline height from when the keyboard was open
    expect(dialog.style.height).toBe("");
    expect(dialog.style.maxHeight).toBe("");
    expect(dialog.style.bottom).toBe("");
  });

  it("repositions cleanly on resizes-visual (iOS Safari) and fully restores after blur + multi-step keyboard close", async () => {
    render(
      <Drawer open={true} onOpenChange={vi.fn()}>
        <DrawerContent className="h-[92dvh] max-h-[92dvh]">
          <DrawerTitle>Test Drawer</DrawerTitle>
          <DrawerDescription>Desc</DrawerDescription>
          <input aria-label="Nota" />
        </DrawerContent>
      </Drawer>
    );

    const dialog = screen.getByRole("dialog");
    const input = screen.getByLabelText("Nota");

    // 1. Focus input & open keyboard in resizes-visual mode (innerHeight stays 800, vv.height drops to 450)
    act(() => {
      input.focus();
      setViewport({
        innerHeight: 800,
        vvHeight: 450,
        fireVvResize: true,
      });
    });

    await waitFor(() => {
      expect(dialog.style.bottom).toBe("350px");
      expect(dialog.style.maxHeight).toBe("434px");
    });
    expect(dialog.style.height).toBe("");

    // 2. User taps Done / outside input (input blurs BEFORE keyboard finishes sliding down in multiple steps)
    act(() => {
      input.blur();
      setViewport({
        innerHeight: 800,
        vvHeight: 580,
        fireVvResize: true,
      });
    });

    await waitFor(() => {
      expect(dialog.style.bottom).toBe("220px");
      expect(dialog.style.maxHeight).toBe("564px");
    });

    // 3. Keyboard finishes closing -> vv.height returns to 800 -> inline overrides must be completely removed
    act(() => {
      setViewport({
        innerHeight: 800,
        vvHeight: 800,
        fireVvResize: true,
      });
    });

    await waitFor(() => {
      expect(dialog.style.bottom).toBe("");
      expect(dialog.style.maxHeight).toBe("");
    });
    expect(dialog.style.height).toBe("");
  });

  it("ignores pinch-zoom changes when no software keyboard is reducing viewport height", async () => {
    render(
      <Drawer open={true} onOpenChange={vi.fn()}>
        <DrawerContent className="h-[92dvh] max-h-[92dvh]">
          <DrawerTitle>Test Drawer</DrawerTitle>
          <DrawerDescription>Desc</DrawerDescription>
          <input aria-label="Nota" />
        </DrawerContent>
      </Drawer>
    );

    const dialog = screen.getByRole("dialog");
    const input = screen.getByLabelText("Nota");

    act(() => {
      input.focus();
      // 2x zoom: vv.height is 400 but vv.height * scale = 800 === innerHeight
      setViewport({
        innerHeight: 800,
        vvHeight: 400,
        scale: 2,
        fireVvResize: true,
      });
    });
    await flushRaf();

    expect(dialog.style.bottom).toBe("");
    expect(dialog.style.maxHeight).toBe("");
    expect(dialog.style.height).toBe("");
  });

  it("keeps TransactionDialog drawer at full mobile height after focusing note (#tx-note-input) and closing keyboard", async () => {
    vi.spyOn(tauriApi, "listBooks").mockResolvedValue([]);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const mockAccounts: AccountView[] = [
      {
        id: "acc-1",
        name: "BCA",
        account_type: "BANK",
        initial_balance: 1_000_000,
        merged_into_id: null,
        root_id: "acc-1",
        is_deleted: 0,
        updated_hlc: "1:1:1",
      },
    ];
    const mockCategories: CategoryView[] = [
      {
        id: "cat-1",
        name: "Jajan",
        normalized_name: "jajan",
        kind: "EXPENSE",
        merged_into_id: null,
        canonical_id: "cat-1",
        is_deleted: 0,
        updated_hlc: "1:1:1",
      },
    ];

    render(
      <QueryClientProvider client={queryClient}>
        <TransactionDialog
          isOpen={true}
          onClose={vi.fn()}
          bookId="book-1"
          accounts={mockAccounts}
          categories={mockCategories}
          editingTx={null}
          onAddTransaction={vi.fn().mockResolvedValue(undefined)}
          onUpdateTransaction={vi.fn().mockResolvedValue(undefined)}
          onTransferBetweenBooks={vi.fn().mockResolvedValue(undefined)}
        />
      </QueryClientProvider>
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("h-[92dvh]");
    expect(dialog.className).toContain("max-h-[92dvh]");

    const noteInput = screen.getByLabelText("Catatan Singkat (Opsional)");

    // Simulate opening keyboard in resizes-content mode, then even a transient visualViewport lag, then closing keyboard
    act(() => {
      noteInput.focus();
      setViewport({
        innerHeight: 800,
        vvHeight: 450,
        fireVvResize: true,
      });
    });
    await flushRaf();

    act(() => {
      setViewport({
        innerHeight: 450,
        vvHeight: 450,
        fireVvResize: true,
        fireWindowResize: true,
      });
    });
    await flushRaf();

    expect(dialog.style.bottom).toBe("");
    expect(dialog.style.maxHeight).toBe("");
    expect(dialog.style.height).toBe("");

    // Close keyboard
    act(() => {
      noteInput.blur();
      setViewport({
        innerHeight: 800,
        vvHeight: 800,
        fireVvResize: true,
        fireWindowResize: true,
      });
    });
    await flushRaf();

    expect(dialog.style.height).toBe("");
    expect(dialog.style.maxHeight).toBe("");
    expect(dialog.style.bottom).toBe("");
  });
});

describe("Drawer responsive direction & multi-direction layout", () => {
  const originalMatchMedia = window.matchMedia;
  const originalVisualViewport = window.visualViewport;
  const originalInnerHeight = window.innerHeight;

  function setupDesktopMatchMedia(initialMatches: boolean) {
    let matches = initialMatches;
    const listeners = new Set<(e: MediaQueryListEvent) => void>();

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === DRAWER_DESKTOP_MEDIA_QUERY ? matches : false,
      media: query,
      onchange: null,
      addListener: vi.fn((cb: (e: MediaQueryListEvent) => void) => {
        if (query === DRAWER_DESKTOP_MEDIA_QUERY) {
          listeners.add(cb);
        }
      }),
      removeListener: vi.fn((cb: (e: MediaQueryListEvent) => void) => {
        listeners.delete(cb);
      }),
      addEventListener: vi.fn(
        (type: string, cb: (e: MediaQueryListEvent) => void) => {
          if (type === "change" && query === DRAWER_DESKTOP_MEDIA_QUERY) {
            listeners.add(cb);
          }
        }
      ),
      removeEventListener: vi.fn(
        (type: string, cb: (e: MediaQueryListEvent) => void) => {
          if (type === "change") {
            listeners.delete(cb);
          }
        }
      ),
      dispatchEvent: vi.fn(),
    }));

    return {
      setDesktop(next: boolean) {
        matches = next;
        const event = {
          matches: next,
          media: DRAWER_DESKTOP_MEDIA_QUERY,
        } as MediaQueryListEvent;
        for (const cb of Array.from(listeners)) {
          cb(event);
        }
      },
    };
  }

  afterEach(() => {
    vi.restoreAllMocks();
    window.matchMedia = originalMatchMedia;
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      writable: true,
      value: originalVisualViewport,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: originalInnerHeight,
    });
  });

  it("defaults to bottom sheet on mobile viewports and right side drawer on desktop viewports", () => {
    setupDesktopMatchMedia(false);
    const { unmount } = render(
      <Drawer open={true} onOpenChange={vi.fn()}>
        <DrawerContent>
          <DrawerTitle>Mobile Sheet</DrawerTitle>
          <DrawerDescription>Desc</DrawerDescription>
        </DrawerContent>
      </Drawer>
    );

    const mobileDialog = screen.getByRole("dialog");
    expect(mobileDialog).toHaveAttribute("data-vaul-drawer-direction", "bottom");
    expect(mobileDialog.className).toContain("inset-x-0");
    expect(mobileDialog.className).toContain("bottom-0");
    expect(mobileDialog.className).not.toContain("inset-y-0");
    expect(
      mobileDialog.querySelector('[data-drawer-handle="bottom"]')
    ).not.toBeNull();
    unmount();

    setupDesktopMatchMedia(true);
    render(
      <Drawer open={true} onOpenChange={vi.fn()}>
        <DrawerContent>
          <DrawerTitle>Desktop Sheet</DrawerTitle>
          <DrawerDescription>Desc</DrawerDescription>
        </DrawerContent>
      </Drawer>
    );

    const desktopDialog = screen.getByRole("dialog");
    expect(desktopDialog).toHaveAttribute(
      "data-vaul-drawer-direction",
      "right"
    );
    expect(desktopDialog.className).toContain("inset-y-0");
    expect(desktopDialog.className).toContain("right-0");
    expect(desktopDialog.className).toContain("h-dvh");
    expect(desktopDialog.className).toContain("rounded-l-3xl");
    expect(desktopDialog.className).not.toContain("inset-x-0");
    expect(desktopDialog.className).not.toContain("bottom-0");
    expect(desktopDialog.querySelector("[data-drawer-handle]")).toBeNull();
  });

  it("updates open drawer direction reactively when viewport crosses 768px and clears keyboard viewport overrides", async () => {
    const controller = setupDesktopMatchMedia(false);
    const mockVv = createMockVisualViewport(800, 1);
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: 800,
    });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      writable: true,
      value: mockVv,
    });

    const DirectionProbe = () => {
      const dir = useDrawerDirection();
      return <span data-testid="dir-probe">{dir}</span>;
    };

    render(
      <Drawer open={true} onOpenChange={vi.fn()}>
        <DrawerContent>
          <DrawerTitle>Reactive Drawer</DrawerTitle>
          <DrawerDescription>Desc</DrawerDescription>
          <DirectionProbe />
          <input aria-label="Catatan" />
        </DrawerContent>
      </Drawer>
    );

    const dialog = screen.getByRole("dialog");
    expect(screen.getByTestId("dir-probe")).toHaveTextContent("bottom");

    // Simulate mobile keyboard opening
    act(() => {
      screen.getByLabelText("Catatan").focus();
      mockVv.height = 450;
      mockVv.dispatchEvent(new Event("resize"));
    });
    await waitFor(() => {
      expect(dialog.style.bottom).toBe("350px");
    });

    // Cross into desktop breakpoint -> must become right drawer and clear inline bottom/maxHeight
    act(() => {
      controller.setDesktop(true);
    });

    await waitFor(() => {
      expect(dialog).toHaveAttribute("data-vaul-drawer-direction", "right");
      expect(screen.getByTestId("dir-probe")).toHaveTextContent("right");
      expect(dialog.style.bottom).toBe("");
      expect(dialog.style.maxHeight).toBe("");
    });
  });

  it("supports explicit top, left, right, and bottom direction overrides regardless of viewport", () => {
    setupDesktopMatchMedia(false);
    const { rerender } = render(
      <Drawer open={true} onOpenChange={vi.fn()} direction="right">
        <DrawerContent>
          <DrawerTitle>Explicit Right</DrawerTitle>
          <DrawerDescription>Desc</DrawerDescription>
        </DrawerContent>
      </Drawer>
    );

    const rightDialog = screen.getByRole("dialog");
    expect(rightDialog).toHaveAttribute("data-vaul-drawer-direction", "right");
    expect(rightDialog.className).toContain("right-0");

    setupDesktopMatchMedia(true);
    rerender(
      <Drawer open={true} onOpenChange={vi.fn()} direction="left">
        <DrawerContent>
          <DrawerTitle>Explicit Left</DrawerTitle>
          <DrawerDescription>Desc</DrawerDescription>
        </DrawerContent>
      </Drawer>
    );
    const leftDialog = screen.getByRole("dialog");
    expect(leftDialog).toHaveAttribute("data-vaul-drawer-direction", "left");
    expect(leftDialog.className).toContain("left-0");
    expect(leftDialog.className).toContain("rounded-r-3xl");
    expect(leftDialog.querySelector("[data-drawer-handle]")).toBeNull();

    rerender(
      <Drawer open={true} onOpenChange={vi.fn()} direction="top">
        <DrawerContent>
          <DrawerTitle>Explicit Top</DrawerTitle>
          <DrawerDescription>Desc</DrawerDescription>
        </DrawerContent>
      </Drawer>
    );
    const topDialog = screen.getByRole("dialog");
    expect(topDialog).toHaveAttribute("data-vaul-drawer-direction", "top");
    expect(topDialog.className).toContain("top-0");
    expect(topDialog.className).toContain("rounded-b-3xl");
    expect(
      topDialog.querySelector('[data-drawer-handle="top"]')
    ).not.toBeNull();

    rerender(
      <Drawer open={true} onOpenChange={vi.fn()} direction="bottom">
        <DrawerContent>
          <DrawerTitle>Explicit Bottom on Desktop</DrawerTitle>
          <DrawerDescription>Desc</DrawerDescription>
        </DrawerContent>
      </Drawer>
    );
    const bottomDesktopDialog = screen.getByRole("dialog");
    expect(bottomDesktopDialog).toHaveAttribute(
      "data-vaul-drawer-direction",
      "bottom"
    );
    expect(bottomDesktopDialog.className).toContain("bottom-0");
    expect(bottomDesktopDialog.className).toContain("rounded-t-3xl");
    expect(
      bottomDesktopDialog.querySelector('[data-drawer-handle="bottom"]')
    ).not.toBeNull();
  });

  it("does not apply mobile visualViewport bottom/maxHeight adjustments to right-side drawers", async () => {
    setupDesktopMatchMedia(true);
    const mockVv = createMockVisualViewport(800, 1);
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: 800,
    });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      writable: true,
      value: mockVv,
    });

    render(
      <Drawer open={true} onOpenChange={vi.fn()}>
        <DrawerContent>
          <DrawerTitle>Desktop Right</DrawerTitle>
          <DrawerDescription>Desc</DrawerDescription>
          <input aria-label="Field" />
        </DrawerContent>
      </Drawer>
    );

    const dialog = screen.getByRole("dialog");
    act(() => {
      screen.getByLabelText("Field").focus();
      mockVv.height = 450;
      mockVv.dispatchEvent(new Event("resize"));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 35));
    });

    expect(dialog.style.bottom).toBe("");
    expect(dialog.style.maxHeight).toBe("");
  });

  it("inherits resolved desktop direction in DrawerNested and keeps CurrencyInput keypad pinned to bottom", () => {
    setupDesktopMatchMedia(true);

    render(
      <Drawer open={true} onOpenChange={vi.fn()}>
        <DrawerContent>
          <DrawerTitle>Parent</DrawerTitle>
          <DrawerDescription>Parent Desc</DrawerDescription>
          <DrawerNested open={true} onOpenChange={vi.fn()}>
            <DrawerContent data-testid="nested-right-content">
              <DrawerTitle>Nested</DrawerTitle>
              <DrawerDescription>Nested Desc</DrawerDescription>
            </DrawerContent>
          </DrawerNested>
          <CurrencyInput
            aria-label="Nominal Test"
            value={10000}
            onValueChange={vi.fn()}
          />
        </DrawerContent>
      </Drawer>
    );

    const nested = screen.getByTestId("nested-right-content");
    expect(nested).toHaveAttribute("data-vaul-drawer-direction", "right");
    expect(nested.className).toContain("inset-y-0");
    expect(nested.className).toContain("right-0");

    // Clicking CurrencyInput opens calculator drawer pinned to bottom even on desktop
    fireEvent.click(screen.getByLabelText("Nominal Test"));
    const calcDrawer = screen.getByTestId("currency-calculator-drawer");
    expect(calcDrawer).toHaveAttribute("data-vaul-drawer-direction", "bottom");
    expect(calcDrawer.className).toContain("bottom-0");
  });

  it("renders TransactionDialog on the right side cleanly on desktop without forced bottom centering", () => {
    setupDesktopMatchMedia(true);
    vi.spyOn(tauriApi, "listBooks").mockResolvedValue([]);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <TransactionDialog
          isOpen={true}
          onClose={vi.fn()}
          bookId="book-1"
          accounts={[
            {
              id: "acc-1",
              name: "BCA",
              account_type: "BANK",
              initial_balance: 1_000_000,
              merged_into_id: null,
              root_id: "acc-1",
              is_deleted: 0,
              updated_hlc: "1:1:1",
            },
          ]}
          categories={[
            {
              id: "cat-1",
              name: "Jajan",
              normalized_name: "jajan",
              kind: "EXPENSE",
              merged_into_id: null,
              canonical_id: "cat-1",
              is_deleted: 0,
              updated_hlc: "1:1:1",
            },
          ]}
          editingTx={null}
          onAddTransaction={vi.fn().mockResolvedValue(undefined)}
          onUpdateTransaction={vi.fn().mockResolvedValue(undefined)}
          onTransferBetweenBooks={vi.fn().mockResolvedValue(undefined)}
        />
      </QueryClientProvider>
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("data-vaul-drawer-direction", "right");
    expect(dialog.className).toContain("inset-y-0");
    expect(dialog.className).toContain("right-0");
    expect(dialog.className).toContain("sm:max-w-xl");
    expect(dialog.className).not.toContain("inset-x-0");
    expect(dialog.className).not.toContain("sm:h-auto");
    expect(dialog.className).toContain("data-[vaul-drawer-direction=bottom]:sm:mx-auto");
    expect(dialog.querySelector("[data-drawer-handle]")).toBeNull();
  });
});
