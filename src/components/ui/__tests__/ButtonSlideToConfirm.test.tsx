import { describe, expect, it, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ButtonSlideToConfirm } from "../ButtonSlideToConfirm";

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

describe("ButtonSlideToConfirm", () => {
  it("shows pulse animation when knob is pressed and springs back if released below 90%", () => {
    const onConfirm = vi.fn();
    render(
      <ButtonSlideToConfirm
        label="Geser untuk Simpan Transaksi"
        onConfirm={onConfirm}
      />
    );

    const track = screen.getByTestId("button-slide-to-confirm");
    const knob = screen.getByTestId("button-slide-to-confirm-knob");

    expect(track.getAttribute("data-status")).toBe("idle");
    expect(screen.getByText("Geser untuk Simpan Transaksi")).toBeInTheDocument();

    // Press down on the knob
    fireEvent.pointerDown(knob, { pointerId: 1, clientX: 0, button: 0 });
    expect(track.getAttribute("data-status")).toBe("dragging");
    expect(
      screen.getByTestId("button-slide-to-confirm-pulse")
    ).toBeInTheDocument();

    // Drag halfway (120px out of default 240px = 50%)
    fireEvent.pointerMove(knob, { pointerId: 1, clientX: 120 });
    expect(knob.getAttribute("aria-valuenow")).toBe("50");

    // Release at 50% (< 90% threshold)
    fireEvent.pointerUp(knob, { pointerId: 1, clientX: 120 });

    expect(onConfirm).not.toHaveBeenCalled();
    expect(track.getAttribute("data-status")).toBe("idle");
  });

  it("triggers onConfirm when released at >= 90%, shows success checklist animation, and calls onSuccessComplete", async () => {
    const onConfirm = vi.fn().mockResolvedValue({ ok: true });
    const onSuccessComplete = vi.fn();

    render(
      <ButtonSlideToConfirm
        label="Geser untuk Simpan Transaksi"
        onConfirm={onConfirm}
        onSuccessComplete={onSuccessComplete}
        successHoldMs={80}
      />
    );

    const track = screen.getByTestId("button-slide-to-confirm");
    const knob = screen.getByTestId("button-slide-to-confirm-knob");

    fireEvent.pointerDown(knob, { pointerId: 1, clientX: 0, button: 0 });
    // Drag to 100% (240px)
    fireEvent.pointerMove(knob, { pointerId: 1, clientX: 240 });
    expect(knob.getAttribute("aria-valuenow")).toBe("100");
    expect(screen.getByText(/Lepas untuk Simpan/i)).toBeInTheDocument();

    // Release at 100%
    fireEvent.pointerUp(knob, { pointerId: 1, clientX: 240 });

    expect(onConfirm).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(track.getAttribute("data-status")).toBe("success");
      expect(
        screen.getByTestId("button-slide-to-confirm-success")
      ).toBeInTheDocument();
      expect(screen.getByText("Tersimpan!")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(onSuccessComplete).toHaveBeenCalledTimes(1);
    });
  });

  it("shows error animation when validation/save fails and automatically resets back to idle", async () => {
    const onConfirm = vi
      .fn()
      .mockResolvedValue({ ok: false, message: "Nominal harus > Rp 0" });

    render(
      <ButtonSlideToConfirm
        label="Geser untuk Simpan Transaksi"
        onConfirm={onConfirm}
        errorResetMs={250}
      />
    );

    const track = screen.getByTestId("button-slide-to-confirm");
    const progressEl = screen.getByTestId("button-slide-to-confirm-progress");
    const knob = screen.getByTestId("button-slide-to-confirm-knob");

    fireEvent.pointerDown(knob, { pointerId: 1, clientX: 0, button: 0 });
    fireEvent.pointerMove(knob, { pointerId: 1, clientX: 240 });
    fireEvent.pointerUp(knob, { pointerId: 1, clientX: 240 });

    await waitFor(() => {
      expect(track.getAttribute("data-status")).toBe("error");
      expect(progressEl.style.backgroundColor).toMatch(
        /(#e11d48|rgb\(225,\s*29,\s*72\))/i
      );
      expect(
        screen.getByTestId("button-slide-to-confirm-error")
      ).toBeInTheDocument();
      expect(screen.getByText("Nominal harus > Rp 0")).toBeInTheDocument();
    });

    // Wait for automatic slide-back and reset to idle (0%)
    await waitFor(
      () => {
        expect(track.getAttribute("data-status")).toBe("idle");
        expect(knob.getAttribute("aria-valuenow")).toBe("0");
      },
      { timeout: 1500 }
    );
  });
});
