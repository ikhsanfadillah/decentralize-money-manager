import * as React from "react";
import {
  motion,
  AnimatePresence,
  useMotionValue,
  useTransform,
  animate,
} from "motion/react";
import { cn } from "../../lib/utils";

export type SlideConfirmResult =
  | boolean
  | { ok: boolean; message?: string }
  | void;

export type SlideConfirmStatus =
  | "idle"
  | "dragging"
  | "loading"
  | "success"
  | "error";

export interface ButtonSlideToConfirmProps {
  /** Callback triggered when user slides to >= confirmThreshold and releases */
  onConfirm: () => Promise<SlideConfirmResult> | SlideConfirmResult;
  /** Called after the success checklist animation finishes */
  onSuccessComplete?: () => void;
  /** Idle instruction text shown in the center of the track */
  label?: string;
  /** Text shown when knob reaches >= confirmThreshold while still held */
  readyLabel?: string;
  /** Text shown while async onConfirm is executing */
  loadingLabel?: string;
  /** Text shown during the success checklist animation */
  successLabel?: string;
  /** Fallback text shown during the error animation if no message is returned */
  errorLabel?: string;
  /** Threshold (0..1) required on release to trigger confirmation (default: 0.9) */
  confirmThreshold?: number;
  /** Duration in ms to display the success animation before calling onSuccessComplete (default: 720) */
  successHoldMs?: number;
  /** Duration in ms to hold the red error state at 100% before sliding back to 0% (default: 950) */
  errorResetMs?: number;
  /** Disable interaction */
  disabled?: boolean;
  className?: string;
  "data-testid"?: string;
}

const KNOB_SIZE_PX = 40;
const TRACK_PADDING_PX = 4;

const BURST_ANGLES = [0, 60, 120, 180, 240, 300];

export const ButtonSlideToConfirm: React.FC<ButtonSlideToConfirmProps> = ({
  onConfirm,
  onSuccessComplete,
  label = "Geser untuk Simpan Transaksi",
  readyLabel = "Lepas untuk Simpan",
  loadingLabel = "Menyimpan...",
  successLabel = "Tersimpan!",
  errorLabel = "Gagal Menyimpan",
  confirmThreshold = 0.9,
  successHoldMs = 720,
  errorResetMs = 950,
  disabled = false,
  className,
  "data-testid": testId = "button-slide-to-confirm",
}) => {
  const trackRef = React.useRef<HTMLDivElement>(null);
  const maxDragRef = React.useRef<number>(240);
  const statusRef = React.useRef<SlideConfirmStatus>("idle");
  const [status, setStatusState] = React.useState<SlideConfirmStatus>("idle");
  const [isPressed, setIsPressed] = React.useState(false);
  const [isReadyToRelease, setIsReadyToRelease] = React.useState(false);
  const [livePct, setLivePct] = React.useState(0);
  const [errorText, setErrorText] = React.useState<string>(errorLabel);

  const dragStartOffsetRef = React.useRef<number>(0);
  const activePointerIdRef = React.useRef<number | null>(null);
  const timersRef = React.useRef<number[]>([]);

  const x = useMotionValue(0);
  const statusCodeMv = useMotionValue<number>(0);
  const statusStrMv = useMotionValue<string>("idle");

  const setStatus = React.useCallback(
    (next: SlideConfirmStatus) => {
      statusRef.current = next;
      statusStrMv.set(next);
      statusCodeMv.set(
        next === "error"
          ? 3
          : next === "success"
            ? 2
            : next === "loading"
              ? 1
              : 0
      );
      setStatusState(next);
    },
    [statusCodeMv, statusStrMv]
  );

  const clearTimers = React.useCallback(() => {
    for (const id of timersRef.current) {
      window.clearTimeout(id);
    }
    timersRef.current = [];
  }, []);

  React.useEffect(() => {
    return () => {
      clearTimers();
    };
  }, [clearTimers]);

  // Measure track width responsively so 0..100% drag distance is always exact
  React.useEffect(() => {
    const el = trackRef.current;
    if (!el) return;

    const updateBounds = () => {
      const width = el.clientWidth;
      const minRequired = KNOB_SIZE_PX + TRACK_PADDING_PX * 2;
      maxDragRef.current = width > minRequired ? width - minRequired : 240;
    };

    updateBounds();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(updateBounds);
      observer.observe(el);
      return () => observer.disconnect();
    }
  }, []);

  // Normalized 0..1 progress derived from MotionValue x
  const progress = useTransform(x, (latestX) => {
    const max = maxDragRef.current;
    if (max <= 0) return 0;
    return Math.min(1, Math.max(0, latestX / max));
  });

  // Width of the progress fill bar behind the knob (follows x during drag AND during error slide-back)
  const fillWidth = useTransform(
    [x, statusCodeMv],
    ([latestX, code]: number[]) => {
      if (code === 1 || code === 2) {
        return "100%";
      }
      const max = maxDragRef.current;
      const clamped = Math.max(0, Math.min(max, latestX ?? 0));
      return `${clamped + KNOB_SIZE_PX + TRACK_PADDING_PX * 2}px`;
    }
  );

  // Light-to-darker emerald color interpolation from 0% -> 45% -> 85% -> 100%
  const baseEmeraldColor = useTransform(
    progress,
    [0, 0.45, 0.85, 1],
    ["#6ee7b7", "#34d399", "#10b981", "#15803d"]
  );

  const fillBackgroundColor = useTransform(
    [baseEmeraldColor, statusStrMv],
    ([emerald, currentStatus]: string[]) => {
      if (currentStatus === "error") {
        return "#e11d48";
      }
      if (currentStatus === "success" || currentStatus === "loading") {
        return "#15803d";
      }
      return emerald ?? "#10b981";
    }
  );

  // Subtle opacity ramp so at 0% the track is clean and as the knob moves it fills smoothly to 100%
  const baseFillOpacity = useTransform(progress, [0, 0.03, 1], [0, 0.85, 1]);
  const fillOpacity = useTransform(
    [baseFillOpacity, statusCodeMv],
    ([op, code]: number[]) => {
      if (code === 1 || code === 2) {
        return 1;
      }
      return op ?? 0;
    }
  );

  // Idle label fades & slides slightly right as the user drags
  const idleLabelOpacity = useTransform(progress, [0, 0.48], [1, 0]);
  const idleLabelX = useTransform(progress, [0, 0.48], [0, 16]);

  const springBackToStart = React.useCallback(() => {
    setIsPressed(false);
    setIsReadyToRelease(false);
    setLivePct(0);
    setStatus("idle");
    animate(x, 0, {
      type: "spring",
      stiffness: 340,
      damping: 30,
    });
  }, [setStatus, x]);

  const triggerFailure = React.useCallback(
    (msg?: string) => {
      setErrorText(msg || errorLabel);
      setIsPressed(false);
      // Pin knob & progress bar at 100% and switch color to RED (#e11d48)
      x.stop();
      x.set(maxDragRef.current);
      setStatus("error");

      // After holding red state at 100%, slide knob & red progress bar back to 0%, then reset to idle
      const timerId = window.setTimeout(() => {
        setIsReadyToRelease(false);
        setLivePct(0);
        const controls = animate(x, 0, {
          duration: 0.34,
          ease: [0.22, 1, 0.36, 1],
          onComplete: () => {
            setStatus("idle");
          },
        });
        // Fallback safety timer in case animation is skipped in reduced-motion or test environment
        const fallbackId = window.setTimeout(() => {
          controls.stop();
          x.set(0);
          setStatus("idle");
        }, 380);
        timersRef.current.push(fallbackId);
      }, errorResetMs);
      timersRef.current.push(timerId);
    },
    [errorLabel, errorResetMs, setStatus, x]
  );

  const triggerSuccess = React.useCallback(() => {
    setIsPressed(false);
    x.stop();
    x.set(maxDragRef.current);
    setStatus("success");

    const timerId = window.setTimeout(() => {
      onSuccessComplete?.();
    }, successHoldMs);
    timersRef.current.push(timerId);
  }, [onSuccessComplete, setStatus, successHoldMs, x]);

  const executeConfirm = React.useCallback(async () => {
    setStatus("loading");
    setIsPressed(false);
    setLivePct(100);
    x.stop();
    x.set(maxDragRef.current);

    try {
      const result = await onConfirm();
      if (result === false) {
        triggerFailure();
        return;
      }
      if (
        typeof result === "object" &&
        result !== null &&
        "ok" in result &&
        !result.ok
      ) {
        triggerFailure(result.message);
        return;
      }
      triggerSuccess();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : errorLabel;
      triggerFailure(msg);
    }
  }, [errorLabel, onConfirm, setStatus, triggerFailure, triggerSuccess, x]);

  const isInteractive =
    !disabled && (status === "idle" || status === "dragging");

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isInteractive) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;

    e.stopPropagation();
    const trackEl = trackRef.current;
    if (trackEl) {
      const minRequired = KNOB_SIZE_PX + TRACK_PADDING_PX * 2;
      maxDragRef.current =
        trackEl.clientWidth > minRequired
          ? trackEl.clientWidth - minRequired
          : 240;
    }

    const pid = e.pointerId ?? 0;
    const startClientX = Number.isFinite(e.clientX) ? e.clientX : 0;
    activePointerIdRef.current = pid;
    dragStartOffsetRef.current = startClientX - x.get();
    setIsPressed(true);
    setStatus("dragging");

    try {
      e.currentTarget.setPointerCapture?.(pid);
    } catch {
      // Ignore in environments where setPointerCapture is not supported
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const pid = e.pointerId ?? 0;
    if (status !== "dragging" || activePointerIdRef.current !== pid) {
      return;
    }
    e.stopPropagation();

    const max = maxDragRef.current;
    const currentClientX = Number.isFinite(e.clientX) ? e.clientX : 0;
    const rawNextX = currentClientX - dragStartOffsetRef.current;
    const clampedX = Math.max(0, Math.min(max, rawNextX));
    x.set(clampedX);

    const ratio = max > 0 ? clampedX / max : 0;
    const nextPct = Math.round(ratio * 100);
    setLivePct((prev) => (prev === nextPct ? prev : nextPct));
    const nextReady = ratio >= confirmThreshold;
    setIsReadyToRelease((prev) => (prev === nextReady ? prev : nextReady));
  };

  const finishDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const pid = e.pointerId ?? 0;
    if (status !== "dragging" || activePointerIdRef.current !== pid) {
      return;
    }
    e.stopPropagation();
    activePointerIdRef.current = null;

    try {
      if (e.currentTarget.hasPointerCapture?.(pid)) {
        e.currentTarget.releasePointerCapture(pid);
      }
    } catch {
      // Ignore
    }

    const max = maxDragRef.current;
    const currentProgress = max > 0 ? x.get() / max : 0;
    if (currentProgress >= confirmThreshold) {
      void executeConfirm();
    } else {
      springBackToStart();
    }
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    const pid = e.pointerId ?? 0;
    if (activePointerIdRef.current !== pid) return;
    activePointerIdRef.current = null;
    springBackToStart();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isInteractive) return;
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      void executeConfirm();
    }
  };

  return (
    <motion.div
      ref={trackRef}
      data-testid={testId}
      data-status={status}
      data-vaul-no-drag=""
      onPointerDown={(e) => e.stopPropagation()}
      animate={
        status === "error"
          ? { x: [0, -9, 9, -6, 6, -3, 3, 0] }
          : { x: 0 }
      }
      transition={{ duration: 0.42, ease: "easeInOut" }}
      className={cn(
        "relative flex h-12 w-full select-none items-center overflow-hidden rounded-lg border border-border bg-emerald-500/10 p-1 touch-none transition-colors duration-200",
        disabled && "opacity-50 pointer-events-none",
        status === "error" && "border-rose-600! bg-rose-500/15!",
        status === "success" && "border-primary bg-primary",
        className
      )}
    >
      {/* Dynamic Progress Fill Bar (0% Light Emerald -> 100% Dark Emerald, Red on Error) */}
      <motion.div
        data-testid={`${testId}-progress`}
        style={{
          width: fillWidth,
          backgroundColor: fillBackgroundColor,
          opacity: fillOpacity,
        }}
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 z-0 rounded-md transition-colors duration-150",
          status === "error" && "bg-rose-600!",
          (status === "success" || status === "loading") &&
            "w-full! bg-primary! opacity-100!"
        )}
      />

      {/* Center Track Label & State Overlays */}
      <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-12">
        <AnimatePresence mode="popLayout">
          {(status === "idle" || status === "dragging") && (
            <motion.div
              key="track-label"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16 }}
              className="flex items-center justify-center gap-2 text-xs font-semibold tracking-tight"
            >
              {status === "dragging" && isReadyToRelease ? (
                <motion.span
                  key="ready"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="font-semibold text-white"
                >
                  {readyLabel}
                </motion.span>
              ) : (
                <motion.span
                  style={{ opacity: idleLabelOpacity, x: idleLabelX }}
                  className="text-foreground/90 flex items-center gap-1.5"
                >
                  <span>{label}</span>
                  <span
                    aria-hidden="true"
                    className="inline-flex items-center text-primary/80 font-mono text-[11px]"
                  >
                    »»
                  </span>
                </motion.span>
              )}
            </motion.div>
          )}

          {status === "loading" && (
            <motion.div
              key="loading"
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.92 }}
              transition={{ duration: 0.18 }}
              className="flex items-center gap-2 text-xs font-semibold text-white"
            >
              <motion.span
                animate={{ rotate: 360 }}
                transition={{
                  repeat: Infinity,
                  duration: 0.75,
                  ease: "linear",
                }}
                className="inline-block h-4 w-4 rounded-full border-2 border-white/30 border-t-white"
              />
              <span>{loadingLabel}</span>
            </motion.div>
          )}

          {status === "success" && (
            <motion.div
              key="success"
              data-testid={`${testId}-success`}
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{
                type: "spring",
                stiffness: 420,
                damping: 24,
              }}
              className="flex items-center justify-center gap-2.5 text-white"
            >
              {/* Celebratory Checkmark Badge + Ring + Burst Particles */}
              <div className="relative flex h-7 w-7 items-center justify-center">
                {/* Expanding Ripple Ring */}
                <motion.span
                  initial={{ scale: 0.6, opacity: 0.85 }}
                  animate={{ scale: 2.1, opacity: 0 }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                  className="absolute inset-0 rounded-full border-2 border-white"
                />

                {/* Radial Particle Burst */}
                {BURST_ANGLES.map((deg) => {
                  const rad = (deg * Math.PI) / 180;
                  const tx = Math.cos(rad) * 18;
                  const ty = Math.sin(rad) * 18;
                  return (
                    <motion.span
                      key={deg}
                      initial={{ x: 0, y: 0, scale: 0, opacity: 1 }}
                      animate={{
                        x: tx,
                        y: ty,
                        scale: [0, 1.15, 0],
                        opacity: [1, 1, 0],
                      }}
                      transition={{ duration: 0.52, ease: "easeOut" }}
                      className="absolute h-1.5 w-1.5 rounded-full bg-emerald-200"
                    />
                  );
                })}

                {/* Circle Container */}
                <motion.div
                  initial={{ scale: 0.4 }}
                  animate={{ scale: [0.4, 1.15, 1] }}
                  transition={{ duration: 0.36, ease: "easeOut" }}
                  className="relative flex h-6 w-6 items-center justify-center rounded-full bg-white text-emerald-700"
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <motion.path
                      d="M20 6 9 17l-5-5"
                      initial={{ pathLength: 0, opacity: 0 }}
                      animate={{ pathLength: 1, opacity: 1 }}
                      transition={{
                        duration: 0.32,
                        ease: "easeOut",
                        delay: 0.08,
                      }}
                    />
                  </svg>
                </motion.div>
              </div>

              <motion.span
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.25, delay: 0.1 }}
                className="text-xs font-bold tracking-wide text-white"
              >
                {successLabel}
              </motion.span>
            </motion.div>
          )}

          {status === "error" && (
            <motion.div
              key="error"
              data-testid={`${testId}-error`}
              initial={{ opacity: 0, scale: 0.88 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{
                type: "spring",
                stiffness: 420,
                damping: 25,
              }}
              className="flex items-center justify-center gap-2 text-white"
            >
              <motion.div
                initial={{ scale: 0.5, rotate: -20 }}
                animate={{ scale: [0.5, 1.12, 1], rotate: 0 }}
                transition={{ duration: 0.3 }}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-rose-600"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <motion.path
                    d="M18 6 6 18"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.22, ease: "easeOut" }}
                  />
                  <motion.path
                    d="m6 6 12 12"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{
                      duration: 0.22,
                      ease: "easeOut",
                      delay: 0.1,
                    }}
                  />
                </svg>
              </motion.div>
              <span className="truncate text-xs font-bold text-white">
                {errorText}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Draggable Thumb / Knob (stays mounted on error so it turns red & visibly slides back to 0%) */}
      <AnimatePresence>
        {status !== "success" && (
          <motion.div
            key="slide-knob"
            role="slider"
            tabIndex={disabled ? -1 : 0}
            aria-label={label}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={livePct}
            data-testid={`${testId}-knob`}
            style={{ x }}
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{
              opacity: 1,
              scale: isPressed ? 1.07 : 1,
            }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{
              type: "spring",
              stiffness: 440,
              damping: 24,
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishDrag}
            onPointerCancel={handlePointerCancel}
            onKeyDown={handleKeyDown}
            className={cn(
              "relative z-20 flex h-10 w-10 shrink-0 cursor-grab items-center justify-center rounded-md border border-primary/30 bg-primary text-primary-foreground transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary active:cursor-grabbing",
              isReadyToRelease &&
                status !== "error" &&
                "bg-white text-emerald-700 border-white",
              status === "error" &&
                "bg-rose-700! text-white! border-white/60! cursor-default"
            )}
          >
            {/* Subtle Pulse Ripple Aura while Pressed */}
            <AnimatePresence>
              {isPressed && (
                <motion.span
                  key="press-pulse"
                  data-testid={`${testId}-pulse`}
                  initial={{ scale: 0.95, opacity: 0.65 }}
                  animate={{
                    scale: [1, 1.38],
                    opacity: [0.6, 0],
                  }}
                  exit={{ opacity: 0 }}
                  transition={{
                    duration: 0.9,
                    repeat: Infinity,
                    ease: "easeOut",
                  }}
                  className="pointer-events-none absolute inset-0 rounded-md border-2 border-primary bg-primary/25"
                />
              )}
            </AnimatePresence>

            {/* Knob Icon: Arrow on idle/drag, Check preview when >= 90%, X when error */}
            <motion.div
              animate={{
                x: isPressed && !isReadyToRelease ? [0, 2.5, 0] : 0,
                scale: isReadyToRelease || status === "error" ? 1.1 : 1,
              }}
              transition={
                isPressed && !isReadyToRelease
                  ? { duration: 0.7, repeat: Infinity, ease: "easeInOut" }
                  : { duration: 0.18 }
              }
              className="relative z-10 flex items-center justify-center"
            >
              {status === "error" ? (
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              ) : isReadyToRelease ? (
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              ) : (
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="m6 17 5-5-5-5" />
                  <path d="m13 17 5-5-5-5" />
                </svg>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

ButtonSlideToConfirm.displayName = "ButtonSlideToConfirm";
