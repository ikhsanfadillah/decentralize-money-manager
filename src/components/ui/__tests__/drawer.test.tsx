import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "../drawer";
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
