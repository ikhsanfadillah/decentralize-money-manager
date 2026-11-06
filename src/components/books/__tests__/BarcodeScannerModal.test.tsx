import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BarcodeScannerModal } from "../BarcodeScannerModal";
import { encodeInviteToken, type InviteTokenPayload } from "../../../lib/web-core";

// Mock Html5Qrcode
vi.mock("html5-qrcode", () => {
  class MockHtml5Qrcode {
    static getCameras = vi.fn().mockResolvedValue([
      { id: "cam-1", label: "Front Camera" },
      { id: "cam-2", label: "Back Camera" },
    ]);
    getState() {
      return 1;
    }
    start() {
      return Promise.resolve();
    }
    stop() {
      return Promise.resolve();
    }
    clear() {
      return Promise.resolve();
    }
    scanFile() {
      return Promise.resolve("mock-file-content");
    }
  }
  return {
    Html5Qrcode: MockHtml5Qrcode,
    Html5QrcodeScannerState: {
      UNKNOWN: 0,
      NOT_STARTED: 1,
      SCANNING: 2,
      PAUSED: 3,
    },
  };
});

describe("BarcodeScannerModal", () => {
  const futureExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const pastExpiry = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  const validPayload: InviteTokenPayload = {
    v: 1,
    book_id: "book-12345",
    book_name: "Keuangan Keluarga",
    book_key: "key-abcdef",
    inviter_node_addr: {
      node_id: "node_alpha_beta_123456789",
      relay_url: "https://relay.test",
      direct_addrs: ["127.0.0.1:9000"],
    },
    expires_at: futureExpiry,
  };

  const expiredPayload: InviteTokenPayload = {
    ...validPayload,
    expires_at: pastExpiry,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders scanner modal with camera, upload, and manual tabs when open", () => {
    render(
      <BarcodeScannerModal
        open={true}
        onOpenChange={vi.fn()}
        onJoinBook={vi.fn()}
      />
    );

    expect(screen.getByText("Scan Barcode / QR Undangan")).toBeInTheDocument();
    expect(screen.getByText("Kamera")).toBeInTheDocument();
    expect(screen.getByText("Unggah Gambar")).toBeInTheDocument();
    expect(screen.getByText("Input Manual")).toBeInTheDocument();
  });

  it("switches between camera, upload, and manual input tabs", () => {
    render(
      <BarcodeScannerModal
        open={true}
        onOpenChange={vi.fn()}
        onJoinBook={vi.fn()}
      />
    );

    // Switch to manual input
    fireEvent.click(screen.getByText("Input Manual"));
    expect(
      screen.getByPlaceholderText(/Tempel link undangan/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Verifikasi & Periksa Kode/i })
    ).toBeInTheDocument();

    // Switch to upload
    fireEvent.click(screen.getByText("Unggah Gambar"));
    expect(
      screen.getByText(/Pilih file gambar atau tangkapan layar QR/i)
    ).toBeInTheDocument();
  });

  it("displays book preview card and confirmation slide when valid invite token is entered", async () => {
    const handleJoin = vi.fn().mockResolvedValue(undefined);
    const token = encodeInviteToken(validPayload);

    render(
      <BarcodeScannerModal
        open={true}
        onOpenChange={vi.fn()}
        onJoinBook={handleJoin}
      />
    );

    fireEvent.click(screen.getByText("Input Manual"));
    const textarea = screen.getByPlaceholderText(/Tempel link undangan/i);
    fireEvent.change(textarea, { target: { value: token } });

    fireEvent.click(
      screen.getByRole("button", { name: /Verifikasi & Periksa Kode/i })
    );

    await waitFor(() => {
      expect(
        screen.getByText("Konfirmasi Bergabung ke Buku")
      ).toBeInTheDocument();
      expect(screen.getByText("Keuangan Keluarga")).toBeInTheDocument();
      expect(screen.getByText(/Valid/i)).toBeInTheDocument();
    });
  });

  it("shows expired warning when an expired invite token is detected", async () => {
    const token = encodeInviteToken(expiredPayload);

    render(
      <BarcodeScannerModal
        open={true}
        onOpenChange={vi.fn()}
        onJoinBook={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("Input Manual"));
    const textarea = screen.getByPlaceholderText(/Tempel link undangan/i);
    fireEvent.change(textarea, { target: { value: token } });

    fireEvent.click(
      screen.getByRole("button", { name: /Verifikasi & Periksa Kode/i })
    );

    await waitFor(() => {
      expect(screen.getByText(/Masa Berlaku Habis/i)).toBeInTheDocument();
      expect(screen.getAllByText(/Kedaluwarsa/i).length).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows informative error message when camera is locked or not readable", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn().mockResolvedValue({}),
        enumerateDevices: vi.fn().mockResolvedValue([]),
      },
      configurable: true,
    });

    const { Html5Qrcode } = await import("html5-qrcode");
    vi.spyOn(Html5Qrcode.prototype, "start").mockRejectedValue(
      new Error("NotReadableError: Could not start video source")
    );

    render(
      <BarcodeScannerModal
        open={true}
        onOpenChange={vi.fn()}
        onJoinBook={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Kamera tidak dapat diakses")).toBeInTheDocument();
      expect(
        screen.getByText(/Kamera sedang digunakan atau dikunci oleh aplikasi lain/i)
      ).toBeInTheDocument();
    });
  });
});
