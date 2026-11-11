import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SmartMagicInputBar } from "../SmartMagicInputBar";
import { useAiStore } from "../../../stores/ai-store";
import type { AccountView, CategoryView } from "../../../lib/tauri-api";

beforeAll(() => {
  if (typeof window !== "undefined" && !window.PointerEvent) {
    class MockPointerEvent extends MouseEvent {
      pointerId: number;
      pointerType: string;
      constructor(type: string, params: PointerEventInit = {}) {
        super(type, params);
        this.pointerId = params.pointerId ?? 0;
        this.pointerType = params.pointerType ?? "mouse";
      }
    }
    window.PointerEvent =
      MockPointerEvent as unknown as typeof window.PointerEvent;
  }
});

describe("SmartMagicInputBar Quick Examples Horizontal Slider", () => {
  const accounts: AccountView[] = [
    {
      id: "acc-1",
      name: "GoPay",
      account_type: "EWALLET",
      initial_balance: 500_000,
      merged_into_id: null,
      root_id: "acc-1",
      is_deleted: 0,
      updated_hlc: "1:1:1",
    },
  ];

  const categories: CategoryView[] = [
    {
      id: "cat-1",
      name: "Makan",
      normalized_name: "makan",
      kind: "EXPENSE",
      merged_into_id: null,
      canonical_id: "cat-1",
      is_deleted: 0,
      updated_hlc: "1:1:1",
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
    useAiStore.setState({
      byok: {
        activeProvider: "gemini",
        providers: {
          gemini: {
            apiKey: "test-key",
            model: "gemini-3.8-flash",
            baseUrl: "https://generativelanguage.googleapis.com/v1beta",
          },
          openai: {
            apiKey: "",
            model: "gpt-4o-mini",
            baseUrl: "https://api.openai.com/v1",
          },
          deepseek: {
            apiKey: "",
            model: "deepseek-chat",
            baseUrl: "https://api.deepseek.com",
          },
          groq: {
            apiKey: "",
            model: "llama-3.3-70b-versatile",
            baseUrl: "https://api.groq.com/openai/v1",
          },
          openrouter: {
            apiKey: "",
            model: "google/gemini-2.5-flash",
            baseUrl: "https://openrouter.ai/api/v1",
          },
        },
      },
    });
  });

  const renderComponent = (hideSubmitButton = true) =>
    render(
      <SmartMagicInputBar
        bookId="book-1"
        accounts={accounts}
        categories={categories}
        hideSubmitButton={hideSubmitButton}
        onApplySingleDraft={vi.fn()}
        onSaveMultipleDrafts={vi.fn().mockResolvedValue(undefined)}
      />
    );

  it("renders quick examples inside a single-row horizontal slider protected from Vaul drawer drag", () => {
    renderComponent();

    const slider = screen.getByTestId("quick-examples-slider");
    expect(slider).toHaveAttribute("data-vaul-no-drag", "");
    expect(slider.className).toContain("flex-nowrap");
    expect(slider.className).toContain("overflow-x-auto");
    expect(slider.className).toContain("no-scrollbar");
    expect(slider.className).toContain("touch-pan-x");
    expect(slider.className).toContain("snap-x");

    const chips = [
      screen.getByRole("button", { name: "Makan siang 45rb pakai GoPay" }),
      screen.getByRole("button", { name: "Kopi 22rb & parkir 3rb tunai" }),
      screen.getByRole("button", { name: "Gaji bulanan 8,5jt ke BCA" }),
      screen.getByRole("button", { name: "Transfer 500rb dari BCA ke GoPay" }),
    ];

    for (const chip of chips) {
      expect(chip).toHaveAttribute("aria-pressed", "false");
      expect(chip.className).toContain("shrink-0");
      expect(chip.className).toContain("whitespace-nowrap");
      expect(chip.className).toContain("snap-start");
    }
  });

  it("populates prompt textarea and toggles active aria-pressed state when a quick example chip is clicked", () => {
    renderComponent();

    const textarea = screen.getByTestId("magic-input-text") as HTMLTextAreaElement;
    const chip = screen.getByRole("button", {
      name: "Kopi 22rb & parkir 3rb tunai",
    });

    fireEvent.click(chip);

    expect(textarea.value).toBe("Kopi 22rb & parkir 3rb tunai");
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "Makan siang 45rb pakai GoPay" })
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("shows slide navigation controls when overflowing and supports stepping & mouse drag-to-slide without triggering chip click", () => {
    renderComponent();

    const slider = screen.getByTestId("quick-examples-slider");
    Object.defineProperty(slider, "clientWidth", {
      configurable: true,
      value: 320,
    });
    Object.defineProperty(slider, "scrollWidth", {
      configurable: true,
      value: 860,
    });
    slider.scrollLeft = 0;

    fireEvent.scroll(slider);

    const prevBtn = screen.getByRole("button", {
      name: "Geser contoh cepat ke kiri",
    });
    const nextBtn = screen.getByRole("button", {
      name: "Geser contoh cepat ke kanan",
    });

    expect(prevBtn).toBeDisabled();
    expect(nextBtn).not.toBeDisabled();

    // Step right via button
    fireEvent.click(nextBtn);
    expect(slider.scrollLeft).toBeGreaterThan(0);
    expect(prevBtn).not.toBeDisabled();

    // Mouse drag on a chip slides scrollLeft and suppresses accidental click
    const chip = screen.getByRole("button", {
      name: "Makan siang 45rb pakai GoPay",
    });
    const textarea = screen.getByTestId("magic-input-text") as HTMLTextAreaElement;
    const startScroll = slider.scrollLeft;

    fireEvent.pointerDown(chip, {
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      clientX: 200,
    });
    fireEvent.pointerMove(window, {
      pointerId: 1,
      pointerType: "mouse",
      clientX: 120,
    });
    fireEvent.pointerUp(window, {
      pointerId: 1,
      pointerType: "mouse",
      clientX: 120,
    });

    expect(slider.scrollLeft).toBe(startScroll + 80);

    // Simulated trailing click right after drag release must be suppressed
    fireEvent.click(chip);
    expect(textarea.value).toBe("");
  });
});

