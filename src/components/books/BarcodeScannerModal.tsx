import * as React from "react";
import {
  Camera,
  CheckCircle2,
  FileText,
  ImageIcon,
  RefreshCw,
  ScanLine,
  SwitchCamera,
  Upload,
  X,
  AlertTriangle,
} from "lucide-react";
import { Html5Qrcode, Html5QrcodeScannerState } from "html5-qrcode";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "../ui/drawer";
import {
  ButtonSlideToConfirm,
  type SlideConfirmResult,
} from "../ui/ButtonSlideToConfirm";
import {
  decodeInviteToken,
  type InviteTokenPayload,
} from "../../lib/web-core";
import { formatExpiryTime } from "../../lib/date";
import { pushToast } from "../../lib/toast";

export interface BarcodeScannerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onJoinBook: (invitePayload: string) => Promise<void>;
  isJoining?: boolean;
}

type ScanMode = "camera" | "upload" | "manual";

/**
 * Play a short subtle audio beep when code is successfully scanned
 */
function playScanBeep() {
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime); // A5 note
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.12);
  } catch {
    // Ignore audio restriction errors
  }
}

/**
 * Parse camera error message with clear, actionable diagnostics
 */
function parseCameraErrorMessage(err: unknown): string {
  const errString =
    typeof err === "string"
      ? err
      : err instanceof Error
        ? `${err.name}: ${err.message}`
        : String(err);

  const lower = errString.toLowerCase();

  if (
    lower.includes("notallowederror") ||
    lower.includes("permissiondenied") ||
    lower.includes("permission denied") ||
    lower.includes("permission dismissed")
  ) {
    return "Izin kamera diblokir di browser. Pastikan izin kamera telah diizinkan (klik ikon gembok / setelan situs di samping URL browser).";
  }

  if (
    lower.includes("notreadableerror") ||
    lower.includes("could not start video source") ||
    lower.includes("concurrent") ||
    lower.includes("in use")
  ) {
    return "Kamera sedang digunakan atau dikunci oleh aplikasi lain (seperti Zoom, Google Meet, Teams, aplikasi Kamera Windows, atau tab browser lain). Tutup aplikasi tersebut lalu klik Coba Akses Lagi.";
  }

  if (
    lower.includes("notfounderror") ||
    lower.includes("devicesnotfounderror") ||
    lower.includes("requested device not found")
  ) {
    return "Tidak ditemukan perangkat kamera yang aktif pada laptop/HP Anda.";
  }

  if (
    lower.includes("overconstrainederror") ||
    lower.includes("constraint")
  ) {
    return "Konfigurasi kamera tidak didukung oleh perangkat ini.";
  }

  if (
    lower.includes("secure") ||
    lower.includes("insecure") ||
    lower.includes("https")
  ) {
    return "Akses kamera memerlukan koneksi aman (HTTPS atau localhost). Kamera tidak dapat diakses melalui IP jaringan HTTP biasa.";
  }

  if (err instanceof Error && err.message) {
    return err.message;
  }

  if (typeof err === "string" && err.trim().length > 0) {
    return err;
  }

  return "Tidak dapat mengakses kamera. Pastikan izin telah diberikan dan tidak ada aplikasi lain yang sedang menggunakan kamera.";
}

export const BarcodeScannerModal: React.FC<BarcodeScannerModalProps> = ({
  open,
  onOpenChange,
  onJoinBook,
  isJoining = false,
}) => {
  const [mode, setMode] = React.useState<ScanMode>("camera");
  const [cameras, setCameras] = React.useState<Array<{ id: string; label: string }>>([]);
  const [activeCameraId, setActiveCameraId] = React.useState<string | null>(null);
  const [cameraError, setCameraError] = React.useState<string | null>(null);
  const [isCameraStarting, setIsCameraStarting] = React.useState(false);
  const [isScanningActive, setIsScanningActive] = React.useState(false);

  // Scanned payload & preview state
  const [rawScannedText, setRawScannedText] = React.useState<string>("");
  const [parsedPayload, setParsedPayload] = React.useState<InviteTokenPayload | null>(null);
  const [scanErrorMessage, setScanErrorMessage] = React.useState<string | null>(null);
  const [isSuccessFeedback, setIsSuccessFeedback] = React.useState(false);

  // Manual input state
  const [manualInput, setManualInput] = React.useState("");

  const scannerRef = React.useRef<Html5Qrcode | null>(null);
  const isMountedRef = React.useRef(true);
  const isStartingRef = React.useRef(false);
  const activeCameraIdRef = React.useRef<string | null>(null);
  const containerId = "barcode-scanner-viewfinder";

  React.useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Stop camera helper
  const stopCamera = React.useCallback(async () => {
    if (!scannerRef.current) return;
    try {
      const state = scannerRef.current.getState();
      if (
        state === Html5QrcodeScannerState.SCANNING ||
        state === Html5QrcodeScannerState.PAUSED
      ) {
        await scannerRef.current.stop();
      }
    } catch {
      // Ignore stop errors
    } finally {
      if (isMountedRef.current) {
        setIsScanningActive(false);
      }
    }
  }, []);

  // Handle scanned raw text
  const handlePayloadDetected = React.useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      try {
        const decoded = decodeInviteToken(trimmed);

        // Check if expired
        if (
          decoded.expires_at &&
          new Date(decoded.expires_at).getTime() < Date.now()
        ) {
          setScanErrorMessage(
            "Kode undangan ini sudah kedaluwarsa. Minta pengundang membuat kode undangan baru."
          );
          setParsedPayload(decoded);
          setRawScannedText(trimmed);
          void stopCamera();
          return;
        }

        // Valid invite
        playScanBeep();
        setIsSuccessFeedback(true);
        setRawScannedText(trimmed);
        setParsedPayload(decoded);
        setScanErrorMessage(null);
        void stopCamera();
      } catch (err: unknown) {
        const msg =
          err instanceof Error
            ? err.message
            : "Kode barcode/QR ini bukan undangan buku keuangan yang valid";
        setScanErrorMessage(msg);

        // Reset error message after 2.5 seconds if still scanning
        setTimeout(() => {
          if (isMountedRef.current) {
            setScanErrorMessage((prev) => (prev === msg ? null : prev));
          }
        }, 2500);
      }
    },
    [stopCamera]
  );

  // Start camera helper
  const startCamera = React.useCallback(
    async (cameraIdToUse?: string) => {
      if (!open || mode !== "camera" || parsedPayload) return;
      if (isStartingRef.current) return;

      setCameraError(null);
      setIsCameraStarting(true);
      isStartingRef.current = true;

      try {
        // Ensure browser supports camera and secure context
        if (typeof window !== "undefined") {
          if (window.isSecureContext === false) {
            throw new Error(
              "Akses kamera memerlukan koneksi aman (HTTPS atau localhost). Kamera tidak dapat diakses melalui IP jaringan HTTP biasa."
            );
          }
          if (!navigator?.mediaDevices?.getUserMedia) {
            throw new Error(
              "Browser ini tidak mendukung akses kamera langsung (getUserMedia)."
            );
          }
        }

        // Wait to ensure viewfinder container exists in DOM
        const elem = document.getElementById(containerId);
        if (!elem) {
          return;
        }

        // Stop current scanner instance cleanly if running
        await stopCamera();

        if (!scannerRef.current) {
          scannerRef.current = new Html5Qrcode(containerId, {
            verbose: false,
          });
        }

        const scanConfig = {
          fps: 10,
          qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
            const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
            const edge = Math.max(160, Math.floor(minEdge * 0.72));
            return { width: edge, height: edge };
          },
          aspectRatio: 1.0,
        };

        const onScanSuccess = (decodedText: string) => {
          void handlePayloadDetected(decodedText);
        };
        const onScanFailure = () => {
          // ignore individual frame errors
        };

        let started = false;
        let chosenCameraId = cameraIdToUse ?? null;

        if (cameraIdToUse) {
          await scannerRef.current.start(
            cameraIdToUse,
            scanConfig,
            onScanSuccess,
            onScanFailure
          );
          started = true;
        } else {
          // 1. Try environment (back) camera first (standard on mobile)
          try {
            await scannerRef.current.start(
              { facingMode: "environment" },
              scanConfig,
              onScanSuccess,
              onScanFailure
            );
            started = true;
          } catch (envErr) {
            // 2. If environment camera fails (common on laptops/PCs or single-camera devices), try user (front) camera
            try {
              await scannerRef.current.start(
                { facingMode: "user" },
                scanConfig,
                onScanSuccess,
                onScanFailure
              );
              started = true;
            } catch (userErr) {
              // 3. Fallback: discover available video devices directly from enumerateDevices
              if (navigator.mediaDevices?.enumerateDevices) {
                const devices = await navigator.mediaDevices.enumerateDevices();
                const videoDevices = devices.filter(
                  (d) =>
                    d.kind === "videoinput" &&
                    !d.label.toLowerCase().includes("ir ") &&
                    !d.label.toLowerCase().includes("infrared")
                );
                if (videoDevices.length > 0) {
                  await scannerRef.current.start(
                    videoDevices[0].deviceId,
                    scanConfig,
                    onScanSuccess,
                    onScanFailure
                  );
                  started = true;
                  chosenCameraId = videoDevices[0].deviceId;
                } else {
                  throw userErr || envErr;
                }
              } else {
                throw userErr || envErr;
              }
            }
          }
        }

        if (started && isMountedRef.current) {
          setIsScanningActive(true);
          if (chosenCameraId) {
            setActiveCameraId(chosenCameraId);
            activeCameraIdRef.current = chosenCameraId;
          }

          // Discover available cameras passively for camera switch button without interrupting active stream
          try {
            if (navigator.mediaDevices?.enumerateDevices) {
              const devices = await navigator.mediaDevices.enumerateDevices();
              const videoDevices = devices
                .filter(
                  (d) =>
                    d.kind === "videoinput" &&
                    !d.label.toLowerCase().includes("ir ") &&
                    !d.label.toLowerCase().includes("infrared")
                )
                .map((d, index) => ({
                  id: d.deviceId,
                  label: d.label || `Kamera ${index + 1}`,
                }));
              if (isMountedRef.current && videoDevices.length > 0) {
                setCameras(videoDevices);
                if (!chosenCameraId && videoDevices[0]) {
                  setActiveCameraId(videoDevices[0].id);
                  activeCameraIdRef.current = videoDevices[0].id;
                }
              }
            }
          } catch {
            // Ignore passive enumeration error
          }
        }
      } catch (err: unknown) {
        if (isMountedRef.current) {
          setCameraError(parseCameraErrorMessage(err));
        }
      } finally {
        isStartingRef.current = false;
        if (isMountedRef.current) {
          setIsCameraStarting(false);
        }
      }
    },
    [open, mode, parsedPayload, stopCamera, handlePayloadDetected]
  );

  // Switch camera toggle
  const handleToggleCamera = async () => {
    if (cameras.length <= 1) return;
    const currentId = activeCameraIdRef.current || activeCameraId;
    const currentIndex = cameras.findIndex((c) => c.id === currentId);
    const nextIndex = (currentIndex + 1) % cameras.length;
    const nextCamera = cameras[nextIndex];
    await startCamera(nextCamera.id);
  };

  // Lifecycle when open or mode changes
  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (open && mode === "camera" && !parsedPayload) {
      // Delay slightly to ensure Drawer DOM is mounted
      timer = setTimeout(() => {
        void startCamera();
      }, 150);
    } else {
      void stopCamera();
    }

    return () => {
      if (timer) clearTimeout(timer);
      void stopCamera();
    };
  }, [open, mode, parsedPayload, startCamera, stopCamera]);

  // Reset all state when modal closes
  const handleClose = () => {
    void stopCamera();
    setParsedPayload(null);
    setRawScannedText("");
    setScanErrorMessage(null);
    setIsSuccessFeedback(false);
    setManualInput("");
    setMode("camera");
    setCameraError(null);
    onOpenChange(false);
  };

  // Handle file upload scanning
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setScanErrorMessage(null);
    try {
      let scanner = scannerRef.current;
      if (!scanner) {
        scanner = new Html5Qrcode(containerId, { verbose: false });
        scannerRef.current = scanner;
      }
      const decoded = await scanner.scanFile(file, false);
      await handlePayloadDetected(decoded);
    } catch {
      setScanErrorMessage(
        "Gambar tidak mengandung barcode atau QR Code yang dapat dibaca."
      );
    } finally {
      e.target.value = "";
    }
  };

  // Handle manual code verification
  const handleVerifyManual = () => {
    const trimmed = manualInput.trim();
    if (!trimmed) {
      setScanErrorMessage("Masukkan kode atau link undangan terlebih dahulu");
      return;
    }
    void handlePayloadDetected(trimmed);
  };

  // Handle confirmation via ButtonSlideToConfirm
  const handleSlideConfirmJoin = async (): Promise<SlideConfirmResult> => {
    if (!rawScannedText) {
      return { ok: false, message: "Kode undangan tidak ditemukan" };
    }
    try {
      await onJoinBook(rawScannedText);
      return { ok: true };
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Gagal bergabung ke buku";
      pushToast("Gagal bergabung ke buku", {
        description: msg,
        variant: "error",
      });
      return { ok: false, message: "Gagal Bergabung" };
    }
  };

  const isExpired = Boolean(
    parsedPayload?.expires_at &&
      new Date(parsedPayload.expires_at).getTime() < Date.now()
  );

  return (
    <Drawer open={open} onOpenChange={(v) => !v && handleClose()} shouldScaleBackground={false}>
      <DrawerContent className="fixed inset-x-0 bottom-0 z-50 flex h-[100dvh] max-h-[100dvh] w-full flex-col rounded-none border-t border-border bg-card p-0 shadow-2xl focus:outline-none sm:mx-auto sm:h-auto sm:max-h-[90vh] sm:max-w-xl sm:rounded-t-2xl">
        <div className="flex h-full sm:h-auto flex-1 flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6 shrink-0 bg-card">
            <div>
              <DrawerTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                <ScanLine className="h-4 w-4 text-primary" />
                <span>
                  {parsedPayload
                    ? "Konfirmasi Bergabung ke Buku"
                    : "Scan Barcode / QR Undangan"}
                </span>
              </DrawerTitle>
              <DrawerDescription className="mt-0.5 text-xs text-muted-foreground">
                {parsedPayload
                  ? "Periksa detail buku di bawah ini sebelum bergabung."
                  : "Pindai kode QR dari perangkat pasangan, keluarga, atau rekan Anda."}
              </DrawerDescription>
            </div>
            <button
              type="button"
              onClick={handleClose}
              aria-label="Tutup"
              className="nav-touch-item inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Mode Switcher Tabs (Only when not in preview mode) */}
          {!parsedPayload && (
            <div className="flex items-center border-b border-border bg-muted/30 px-4 py-1.5 sm:px-6 gap-1 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setMode("camera");
                  setScanErrorMessage(null);
                }}
                className={`nav-touch-item inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  mode === "camera"
                    ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Camera className="h-3.5 w-3.5" />
                <span>Kamera</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setMode("upload");
                  setScanErrorMessage(null);
                }}
                className={`nav-touch-item inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  mode === "upload"
                    ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <ImageIcon className="h-3.5 w-3.5" />
                <span>Unggah Gambar</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setMode("manual");
                  setScanErrorMessage(null);
                }}
                className={`nav-touch-item inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  mode === "manual"
                    ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <FileText className="h-3.5 w-3.5" />
                <span>Input Manual</span>
              </button>
            </div>
          )}

          {/* Content Body */}
          <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 space-y-4">
            {parsedPayload ? (
              /* Preview Stage */
              <div className="space-y-4 animate-card-up">
                <div
                  className={`rounded-lg border p-4 transition-all ${
                    isSuccessFeedback
                      ? "border-emerald-500/70 bg-emerald-500/5 ring-2 ring-emerald-500/20"
                      : "border-border bg-card"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                        isExpired
                          ? "bg-rose-500/10 text-rose-500"
                          : "bg-emerald-500/10 text-emerald-500"
                      }`}
                    >
                      {isExpired ? (
                        <AlertTriangle className="h-5 w-5" />
                      ) : (
                        <CheckCircle2 className="h-5 w-5" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Undangan Buku Keuangan
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.2 font-mono text-[10px] font-semibold ${
                            isExpired
                              ? "bg-rose-500/15 text-rose-500"
                              : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                          }`}
                        >
                          {isExpired ? "Kedaluwarsa" : "Valid"}
                        </span>
                      </div>
                      <h3 className="mt-1 truncate text-base font-bold text-foreground">
                        {parsedPayload.book_name}
                      </h3>
                      <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                        ID: {parsedPayload.book_id}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2 border-t border-border pt-3 text-xs">
                    <div>
                      <span className="text-muted-foreground block text-[11px]">
                        Masa Berlaku Undangan:
                      </span>
                      <span
                        className={`font-semibold ${
                          isExpired ? "text-rose-500" : "text-foreground"
                        }`}
                      >
                        {formatExpiryTime(parsedPayload.expires_at)}
                      </span>
                    </div>
                    {parsedPayload.inviter_node_addr?.node_id && (
                      <div>
                        <span className="text-muted-foreground block text-[11px]">
                          ID Perangkat Pengundang:
                        </span>
                        <span className="font-mono text-[11px] text-foreground truncate block">
                          {parsedPayload.inviter_node_addr.node_id.slice(0, 16)}...
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {isExpired ? (
                  <div className="rounded border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-600 dark:text-rose-400">
                    <p className="font-semibold">Masa Berlaku Habis</p>
                    <p className="mt-0.5 text-[11px]">
                      Kode ini telah melewati batas waktu 10 menit. Silakan minta
                      pemilik buku untuk membuka menu Sinkronisasi dan membuat
                      undangan baru.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setParsedPayload(null);
                        setRawScannedText("");
                        setMode("camera");
                      }}
                      className="mt-2.5 rounded border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
                    >
                      Scan Ulang Kode Lain
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Setelah bergabung, catatan transaksi buku ini akan
                      disinkronkan secara peer-to-peer (P2P) antar perangkat.
                    </p>
                  </div>
                )}
              </div>
            ) : (
              /* Scanning Stage */
              <div className="space-y-3">
                {/* Mode Camera */}
                {mode === "camera" && (
                  <div className="space-y-3">
                    <div className="relative mx-auto w-full max-w-sm overflow-hidden rounded-xl border border-border bg-black shadow-inner aspect-square flex items-center justify-center">
                      {/* Viewfinder container element used by html5-qrcode */}
                      <div
                        id={containerId}
                        className="w-full h-full [&_video]:w-full [&_video]:h-full [&_video]:object-cover"
                      />

                      {/* Reticle HUD overlay */}
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                        <div className="relative h-48 w-48 rounded-lg border-2 border-primary/70 shadow-lg">
                          {/* Corner markers */}
                          <div className="absolute -top-1 -left-1 h-4 w-4 border-t-2 border-l-2 border-primary" />
                          <div className="absolute -top-1 -right-1 h-4 w-4 border-t-2 border-r-2 border-primary" />
                          <div className="absolute -bottom-1 -left-1 h-4 w-4 border-b-2 border-l-2 border-primary" />
                          <div className="absolute -bottom-1 -right-1 h-4 w-4 border-b-2 border-r-2 border-primary" />
                        </div>
                      </div>

                      {/* Loading or Switch controls */}
                      {isCameraStarting && (
                        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/70 text-white">
                          <RefreshCw className="h-6 w-6 animate-spin text-primary" />
                          <p className="mt-2 text-xs font-medium">
                            Menghubungkan ke kamera...
                          </p>
                        </div>
                      )}

                      {/* Switch Camera Button if multiple cameras available */}
                      {cameras.length > 1 && isScanningActive && (
                        <button
                          type="button"
                          onClick={() => void handleToggleCamera()}
                          title="Ganti Kamera"
                          className="absolute top-3 right-3 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-xs hover:bg-black/80 transition-colors"
                        >
                          <SwitchCamera className="h-4 w-4" />
                        </button>
                      )}
                    </div>

                    <p className="text-center text-xs text-muted-foreground">
                      Posisikan QR Code atau Barcode tepat di dalam kotak
                      pembidik.
                    </p>

                    {/* Camera Error Message */}
                    {cameraError && (
                      <div className="rounded border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
                        <p className="font-semibold flex items-center gap-1.5">
                          <AlertTriangle className="h-4 w-4 shrink-0" />
                          <span>Kamera tidak dapat diakses</span>
                        </p>
                        <p className="mt-1 text-[11px]">{cameraError}</p>
                        <div className="mt-2.5 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void startCamera()}
                            className="rounded border border-border bg-background px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-muted"
                          >
                            Coba Akses Lagi
                          </button>
                          <button
                            type="button"
                            onClick={() => setMode("upload")}
                            className="rounded border border-border bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground hover:opacity-90"
                          >
                            Unggah Gambar QR
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Mode Upload File */}
                {mode === "upload" && (
                  <div className="space-y-3">
                    <label
                      htmlFor="barcode-file-input"
                      className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-muted/10 p-8 text-center cursor-pointer hover:bg-muted/30 hover:border-primary/50 transition-colors"
                    >
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Upload className="h-6 w-6" />
                      </div>
                      <p className="mt-3 text-xs font-semibold text-foreground">
                        Pilih file gambar atau tangkapan layar QR
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Format didukung: PNG, JPG, JPEG, WEBP
                      </p>
                      <input
                        id="barcode-file-input"
                        type="file"
                        accept="image/*"
                        onChange={(e) => void handleFileUpload(e)}
                        className="hidden"
                      />
                    </label>
                  </div>
                )}

                {/* Mode Manual Input */}
                {mode === "manual" && (
                  <div className="space-y-3">
                    <div>
                      <label
                        htmlFor="manual-invite-code"
                        className="block text-xs font-medium text-foreground"
                      >
                        Link atau Kode Undangan Buku
                      </label>
                      <textarea
                        id="manual-invite-code"
                        rows={3}
                        value={manualInput}
                        onChange={(e) => setManualInput(e.target.value)}
                        placeholder="Tempel link undangan (https://.../#/invite?d=...) atau token kode undangan..."
                        className="mt-1.5 w-full rounded border border-input bg-background p-2.5 font-mono text-xs text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleVerifyManual}
                      className="nav-touch-item w-full rounded border border-border bg-primary py-2 text-xs font-semibold text-primary-foreground hover:opacity-90"
                    >
                      Verifikasi & Periksa Kode
                    </button>
                  </div>
                )}

                {/* Scan Error Alert */}
                {scanErrorMessage && (
                  <div className="rounded border border-rose-500/30 bg-rose-500/10 p-2.5 text-xs text-rose-600 dark:text-rose-400 flex items-start gap-2 animate-card-up">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>{scanErrorMessage}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer Controls */}
          {parsedPayload && !isExpired && (
            <div className="flex items-center justify-between gap-3 border-t border-border p-3 sm:px-6 bg-card/60 backdrop-blur-xs shrink-0">
              <button
                type="button"
                onClick={() => {
                  setParsedPayload(null);
                  setRawScannedText("");
                  setMode("camera");
                }}
                disabled={isJoining}
                className="nav-touch-item rounded border border-border bg-background px-3 py-2 text-xs font-medium text-foreground hover:bg-muted"
              >
                Scan Ulang
              </button>

              <div className="flex-1 max-w-xs">
                <ButtonSlideToConfirm
                  key={rawScannedText ? "preview-ready" : "preview-empty"}
                  disabled={isJoining}
                  label="Geser untuk Gabung"
                  readyLabel="Lepas untuk Gabung"
                  loadingLabel="Menghubungkan..."
                  successLabel="Berhasil Bergabung!"
                  onConfirm={handleSlideConfirmJoin}
                  onSuccessComplete={handleClose}
                />
              </div>
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
};
