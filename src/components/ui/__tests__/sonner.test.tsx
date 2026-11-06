import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { Toaster } from "../sonner";
import { pushToast, dismissToast, toast } from "../../../lib/toast";

vi.mock("sonner", async () => {
  const actual = await vi.importActual<typeof import("sonner")>("sonner");
  return {
    ...actual,
    toast: Object.assign(vi.fn(), {
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
      dismiss: vi.fn(),
    }),
  };
});

describe("Sonner Toast Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders Toaster component without error", () => {
    const { container } = render(<Toaster />);
    expect(container).toBeDefined();
  });

  it("calls toast.info by default when variant is not specified or is info", () => {
    pushToast("Informasi sistem", { description: "Sedang sinkronisasi" });
    expect(toast.info).toHaveBeenCalledWith("Informasi sistem", {
      description: "Sedang sinkronisasi",
      duration: 4500,
    });
  });

  it("calls toast.success when variant is success", () => {
    pushToast("Berhasil disimpan", { variant: "success", durationMs: 3000 });
    expect(toast.success).toHaveBeenCalledWith("Berhasil disimpan", {
      description: undefined,
      duration: 3000,
    });
  });

  it("calls toast.error when variant is error", () => {
    pushToast("Gagal memuat", { description: "Network error", variant: "error" });
    expect(toast.error).toHaveBeenCalledWith("Gagal memuat", {
      description: "Network error",
      duration: 4500,
    });
  });

  it("calls toast.warning when variant is warning", () => {
    pushToast("Peringatan saldo", { variant: "warning" });
    expect(toast.warning).toHaveBeenCalledWith("Peringatan saldo", {
      description: undefined,
      duration: 4500,
    });
  });

  it("calls toast.dismiss on dismissToast", () => {
    dismissToast("test-toast-id");
    expect(toast.dismiss).toHaveBeenCalledWith("test-toast-id");
  });
});
