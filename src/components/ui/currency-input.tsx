import * as React from "react";
import { NumericFormat, type NumberFormatValues } from "react-number-format";
import { Input } from "./input";
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
  DrawerDescription,
} from "./drawer";
import { cn, formatRupiah } from "../../lib/utils";

export const MAX_RUPIAH_VALUE = 999_999_999_999_999; // 15 digits, safe for Number.isSafeInteger

export interface CurrencyInputProps {
  value: number | null;
  onValueChange: (value: number | null) => void;
  id?: string;
  name?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  "data-testid"?: string;
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
}

/**
 * Safely evaluates a simple arithmetic expression containing non-negative integers
 * and +, -, *, / operators without using eval().
 * Clamps result to integer within [0, MAX_RUPIAH_VALUE].
 */
export function evaluateCalculatorExpression(expr: string): number | null {
  const trimmed = expr.trim();
  if (!trimmed) {
    return null;
  }

  // Strip trailing operator(s) so partial expressions like "50000+" evaluate to 50000
  const cleanExpr = trimmed.replace(/[+\-*/]+$/, "");
  if (!cleanExpr) {
    return null;
  }

  const tokens = cleanExpr.match(/(\d+|[+\-*/])/g);
  if (!tokens || tokens.length === 0) {
    return null;
  }

  // First pass: evaluate * and /
  const addSubStack: Array<number | "+" | "-"> = [];
  let current = Number(tokens[0]);
  if (!Number.isFinite(current)) {
    return null;
  }

  let i = 1;
  while (i < tokens.length) {
    const op = tokens[i];
    const nextRaw = tokens[i + 1];
    if (nextRaw === undefined) {
      break;
    }
    const nextNum = Number(nextRaw);
    if (!Number.isFinite(nextNum)) {
      break;
    }

    if (op === "*") {
      current = current * nextNum;
    } else if (op === "/") {
      current = nextNum === 0 ? 0 : current / nextNum;
    } else if (op === "+" || op === "-") {
      addSubStack.push(current);
      addSubStack.push(op);
      current = nextNum;
    }
    i += 2;
  }
  addSubStack.push(current);

  // Second pass: evaluate + and -
  let result = addSubStack[0] as number;
  for (let j = 1; j < addSubStack.length; j += 2) {
    const op = addSubStack[j] as "+" | "-";
    const operand = addSubStack[j + 1] as number;
    if (op === "+") {
      result += operand;
    } else {
      result -= operand;
    }
  }

  if (!Number.isFinite(result)) {
    return 0;
  }

  const rounded = Math.round(result);
  if (rounded < 0) {
    return 0;
  }
  if (rounded > MAX_RUPIAH_VALUE) {
    return MAX_RUPIAH_VALUE;
  }
  return rounded;
}

/**
 * Formats raw calculator expression with Indonesian thousand separators and math symbols.
 * Example: "50000+25000*2" -> "50.000 + 25.000 × 2"
 */
export function formatCalculatorExpression(expr: string): string {
  if (!expr) {
    return "0";
  }
  return expr.replace(/(\d+)|([+\-*/])/g, (_match, num, op) => {
    if (num !== undefined) {
      const parsed = Number(num);
      return Number.isFinite(parsed) ? parsed.toLocaleString("id-ID") : num;
    }
    switch (op) {
      case "+":
        return " + ";
      case "-":
        return " − ";
      case "*":
        return " × ";
      case "/":
        return " ÷ ";
      default:
        return op;
    }
  });
}

export const CurrencyInput = React.forwardRef<
  HTMLInputElement,
  CurrencyInputProps
>(
  (
    {
      value,
      onValueChange,
      placeholder = "Rp 0",
      disabled = false,
      className,
      onBlur,
      ...rest
    },
    ref
  ) => {
    const [isCalcOpen, setIsCalcOpen] = React.useState(false);
    const [expression, setExpression] = React.useState<string>(() =>
      value === null || value === undefined || Number.isNaN(value)
        ? ""
        : String(Math.max(0, Math.trunc(value)))
    );

    const wrapperRef = React.useRef<HTMLDivElement>(null);
    const drawerContentRef = React.useRef<HTMLDivElement>(null);

    // Keep expression synced when value changes externally (e.g. form reset, edit mode, or keyboard typing)
    React.useEffect(() => {
      const currentEval = evaluateCalculatorExpression(expression);
      if (value !== currentEval) {
        setExpression(
          value === null || value === undefined || Number.isNaN(value)
            ? ""
            : String(Math.max(0, Math.trunc(value)))
        );
      }
    }, [value, expression]);

    // Ensure non-modal calculator drawer does not aria-hide or pointer-lock surrounding form controls
    React.useEffect(() => {
      if (!isCalcOpen) {
        return;
      }
      const clearAriaHidden = () => {
        if (document.body.style.pointerEvents === "none") {
          document.body.style.pointerEvents = "auto";
        }
        const hiddenNodes = document.querySelectorAll(
          '[data-aria-hidden="true"]'
        );
        hiddenNodes.forEach((node) => {
          node.removeAttribute("aria-hidden");
          node.removeAttribute("data-aria-hidden");
        });
      };
      clearAriaHidden();
      queueMicrotask(clearAriaHidden);
      const observer = new MutationObserver(clearAriaHidden);
      observer.observe(document.body, {
        attributes: true,
        subtree: true,
        attributeFilter: ["data-aria-hidden", "style"],
      });
      return () => {
        observer.disconnect();
      };
    }, [isCalcOpen]);

    // Close calculator drawer when clicking outside both the input wrapper and the bottom drawer
    React.useEffect(() => {
      if (!isCalcOpen) {
        return;
      }
      const handleOutsidePointerDown = (e: MouseEvent | PointerEvent) => {
        const target = e.target;
        if (!(target instanceof Element)) {
          return;
        }
        if (wrapperRef.current?.contains(target)) {
          return;
        }
        if (drawerContentRef.current?.contains(target)) {
          return;
        }
        setIsCalcOpen(false);
      };

      document.addEventListener("pointerdown", handleOutsidePointerDown, true);
      return () => {
        document.removeEventListener(
          "pointerdown",
          handleOutsidePointerDown,
          true
        );
      };
    }, [isCalcOpen]);

    const isAllowed = React.useCallback((values: NumberFormatValues): boolean => {
      if (values.value === "") {
        return true;
      }
      if (values.value.includes("-") || values.value.includes(".")) {
        return false;
      }
      const digitsOnly = values.value.replace(/\D/g, "");
      if (digitsOnly.length > 15) {
        return false;
      }
      if (values.floatValue === undefined) {
        return true;
      }
      return (
        values.floatValue >= 0 &&
        values.floatValue <= MAX_RUPIAH_VALUE &&
        Number.isSafeInteger(values.floatValue)
      );
    }, []);

    const handleValueChange = React.useCallback(
      (values: NumberFormatValues) => {
        if (values.value === "" || values.floatValue === undefined) {
          setExpression("");
          onValueChange(null);
          return;
        }
        const intVal = Math.trunc(values.floatValue);
        setExpression((prev) => {
          const prevEval = evaluateCalculatorExpression(prev);
          return prevEval === intVal ? prev : String(intVal);
        });
        onValueChange(intVal);
      },
      [onValueChange]
    );

    const applyExpression = React.useCallback(
      (nextExpr: string) => {
        setExpression(nextExpr);
        const evaluated = evaluateCalculatorExpression(nextExpr);
        onValueChange(evaluated);
      },
      [onValueChange]
    );

    const handleDigitPress = (digits: string) => {
      const parts = expression.split(/[+\-*/]/);
      const currentOperand = parts[parts.length - 1] ?? "";

      let nextExpr: string;
      if (currentOperand === "0") {
        if (digits === "0" || digits === "000") {
          return;
        }
        nextExpr = expression.slice(0, -1) + digits;
      } else if (currentOperand === "" && digits === "000") {
        nextExpr = expression === "" ? "0" : expression + "0";
      } else {
        nextExpr = expression + digits;
      }

      const nextParts = nextExpr.split(/[+\-*/]/);
      const nextOperand = nextParts[nextParts.length - 1] ?? "";
      if (nextOperand.length > 15) {
        const trimmedOperand = nextOperand.slice(0, 15);
        nextExpr =
          nextExpr.slice(0, nextExpr.length - nextOperand.length) +
          trimmedOperand;
      }

      applyExpression(nextExpr);
    };

    const handleOperatorPress = (op: "+" | "-" | "*" | "/") => {
      const base =
        expression === ""
          ? value !== null && value !== undefined && value > 0
            ? String(Math.trunc(value))
            : ""
          : expression;
      if (!base) {
        return;
      }
      const nextExpr = /[+\-*/]$/.test(base)
        ? base.slice(0, -1) + op
        : base + op;
      applyExpression(nextExpr);
    };

    const handleEqualsPress = () => {
      const evaluated = evaluateCalculatorExpression(expression);
      const nextExpr = evaluated === null ? "" : String(evaluated);
      setExpression(nextExpr);
      onValueChange(evaluated);
    };

    const handleBackspacePress = () => {
      if (!expression) {
        return;
      }
      const nextExpr = expression.slice(0, -1);
      applyExpression(nextExpr);
    };

    const handleClearPress = () => {
      setExpression("");
      onValueChange(null);
    };

    const handleDonePress = () => {
      const evaluated = evaluateCalculatorExpression(expression);
      const nextExpr = evaluated === null ? "" : String(evaluated);
      setExpression(nextExpr);
      onValueChange(evaluated);
      setIsCalcOpen(false);
    };

    const normalizedValue =
      value === null || value === undefined || Number.isNaN(value) ? "" : value;

    const evaluatedPreview = evaluateCalculatorExpression(expression);
    const hasOperatorInExpr = /[+\-*/]/.test(expression);
    const labelTitle = rest["aria-label"] ?? "Kalkulator Nominal";

    return (
      <div ref={wrapperRef} className="relative w-full">
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          data-testid="currency-calc-trigger"
          title="Buka Kalkulator Nominal"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (!disabled) {
              setIsCalcOpen((prev) => !prev);
            }
          }}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect width="16" height="20" x="4" y="2" rx="2" />
            <line x1="8" x2="16" y1="6" y2="6" />
            <line x1="16" x2="16" y1="14" y2="18" />
            <path d="M16 10h.01" />
            <path d="M12 10h.01" />
            <path d="M8 10h.01" />
            <path d="M12 14h.01" />
            <path d="M8 14h.01" />
            <path d="M12 18h.01" />
            <path d="M8 18h.01" />
          </svg>
        </button>

        <NumericFormat
          getInputRef={ref}
          customInput={Input}
          value={normalizedValue}
          onValueChange={handleValueChange}
          isAllowed={isAllowed}
          thousandSeparator="."
          decimalSeparator=","
          decimalScale={0}
          allowNegative={false}
          allowLeadingZeros={false}
          prefix="Rp "
          inputMode="none"
          disabled={disabled}
          placeholder={placeholder}
          onBlur={onBlur}
          onClick={() => {
            if (!disabled) {
              setIsCalcOpen(true);
            }
          }}
          className={cn(
            "pl-8 font-mono tabular-nums tracking-tight text-right shadow-none",
            className
          )}
          {...rest}
        />

        <Drawer
          open={isCalcOpen && !disabled}
          onOpenChange={setIsCalcOpen}
          modal={false}
        >
          <DrawerContent
            ref={drawerContentRef}
            hideOverlay
            data-calculator-drawer="true"
            data-testid="currency-calculator-drawer"
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}
            className="pointer-events-auto z-[70] mx-auto w-full max-w-md border-x border-t border-border bg-card pb-4 shadow-2xl"
          >
            {/* Header & Live Calculation Display */}
            <div className="px-4 pt-2 pb-2.5">
              <div className="mb-1.5 flex items-center justify-between">
                <DrawerTitle className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {labelTitle}
                </DrawerTitle>
                <DrawerDescription className="font-mono text-[10px] text-muted-foreground">
                  Kalkulator Rupiah
                </DrawerDescription>
              </div>

              <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-right">
                <div
                  data-testid="calc-expression-display"
                  className="min-h-[18px] truncate font-mono text-xs text-muted-foreground tabular-nums"
                >
                  {expression ? formatCalculatorExpression(expression) : "0"}
                </div>
                <div
                  data-testid="calc-result-display"
                  className="mt-0.5 truncate font-mono text-lg font-bold tracking-tight text-foreground tabular-nums sm:text-xl"
                >
                  {hasOperatorInExpr ? "= " : ""}
                  {formatRupiah(evaluatedPreview ?? 0)}
                </div>
              </div>
            </div>

            {/* 4x5 Custom Numeric & Calculator Keypad */}
            <div
              data-vaul-no-drag=""
              onMouseDown={(e) => e.preventDefault()}
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
              className="grid grid-cols-4 gap-1.5 px-4"
            >
              {/* Row 1: C, Backspace, 000, Divide */}
              <button
                type="button"
                data-testid="calc-key-clear"
                aria-label="Reset kalkulator"
                onClick={handleClearPress}
                className="flex h-11 items-center justify-center rounded-md border border-border bg-muted/40 font-mono text-sm font-bold text-rose-500 transition-colors hover:bg-muted active:scale-[0.98]"
              >
                C
              </button>
              <button
                type="button"
                data-testid="calc-key-backspace"
                aria-label="Hapus digit"
                onClick={handleBackspacePress}
                className="flex h-11 items-center justify-center rounded-md border border-border bg-muted/40 font-mono text-sm font-semibold text-foreground transition-colors hover:bg-muted active:scale-[0.98]"
              >
                ⌫
              </button>
              <button
                type="button"
                data-testid="calc-key-000"
                onClick={() => handleDigitPress("000")}
                className="flex h-11 items-center justify-center rounded-md border border-border bg-background font-mono text-xs font-semibold text-foreground transition-colors hover:bg-muted active:scale-[0.98]"
              >
                000
              </button>
              <button
                type="button"
                data-testid="calc-key-div"
                aria-label="Bagi"
                onClick={() => handleOperatorPress("/")}
                className="flex h-11 items-center justify-center rounded-md border border-border bg-muted/60 font-mono text-base font-bold text-primary transition-colors hover:bg-muted active:scale-[0.98]"
              >
                ÷
              </button>

              {/* Row 2: 7, 8, 9, Multiply */}
              {(["7", "8", "9"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  data-testid={`calc-key-${d}`}
                  onClick={() => handleDigitPress(d)}
                  className="flex h-11 items-center justify-center rounded-md border border-border bg-background font-mono text-base font-semibold text-foreground transition-colors hover:bg-muted active:scale-[0.98]"
                >
                  {d}
                </button>
              ))}
              <button
                type="button"
                data-testid="calc-key-mul"
                aria-label="Kali"
                onClick={() => handleOperatorPress("*")}
                className="flex h-11 items-center justify-center rounded-md border border-border bg-muted/60 font-mono text-base font-bold text-primary transition-colors hover:bg-muted active:scale-[0.98]"
              >
                ×
              </button>

              {/* Row 3: 4, 5, 6, Subtract */}
              {(["4", "5", "6"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  data-testid={`calc-key-${d}`}
                  onClick={() => handleDigitPress(d)}
                  className="flex h-11 items-center justify-center rounded-md border border-border bg-background font-mono text-base font-semibold text-foreground transition-colors hover:bg-muted active:scale-[0.98]"
                >
                  {d}
                </button>
              ))}
              <button
                type="button"
                data-testid="calc-key-sub"
                aria-label="Kurang"
                onClick={() => handleOperatorPress("-")}
                className="flex h-11 items-center justify-center rounded-md border border-border bg-muted/60 font-mono text-base font-bold text-primary transition-colors hover:bg-muted active:scale-[0.98]"
              >
                −
              </button>

              {/* Row 4: 1, 2, 3, Add */}
              {(["1", "2", "3"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  data-testid={`calc-key-${d}`}
                  onClick={() => handleDigitPress(d)}
                  className="flex h-11 items-center justify-center rounded-md border border-border bg-background font-mono text-base font-semibold text-foreground transition-colors hover:bg-muted active:scale-[0.98]"
                >
                  {d}
                </button>
              ))}
              <button
                type="button"
                data-testid="calc-key-add"
                aria-label="Tambah"
                onClick={() => handleOperatorPress("+")}
                className="flex h-11 items-center justify-center rounded-md border border-border bg-muted/60 font-mono text-base font-bold text-primary transition-colors hover:bg-muted active:scale-[0.98]"
              >
                +
              </button>

              {/* Row 5: 0, Equals (=), Done / Checklist (✓ Selesai) */}
              <button
                type="button"
                data-testid="calc-key-0"
                onClick={() => handleDigitPress("0")}
                className="flex h-11 items-center justify-center rounded-md border border-border bg-background font-mono text-base font-semibold text-foreground transition-colors hover:bg-muted active:scale-[0.98]"
              >
                0
              </button>
              <button
                type="button"
                data-testid="calc-key-eq"
                aria-label="Sama dengan"
                onClick={handleEqualsPress}
                className="flex h-11 items-center justify-center rounded-md border border-border bg-muted/60 font-mono text-base font-bold text-foreground transition-colors hover:bg-muted active:scale-[0.98]"
              >
                =
              </button>
              <button
                type="button"
                data-testid="calc-key-done"
                aria-label="Selesai"
                onClick={handleDonePress}
                className="col-span-2 flex h-11 items-center justify-center gap-1.5 rounded-md border border-border bg-primary font-mono text-xs font-bold text-primary-foreground transition-opacity hover:opacity-90 active:scale-[0.98]"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                <span>Selesai</span>
              </button>
            </div>
          </DrawerContent>
        </Drawer>
      </div>
    );
  }
);

CurrencyInput.displayName = "CurrencyInput";
