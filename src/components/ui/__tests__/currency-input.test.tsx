import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm, Controller } from "react-hook-form";
import { CurrencyInput } from "../currency-input";

const ControlledCurrencyHarness: React.FC<{
  initialValue?: number | null;
  onObservedChange?: (val: number | null) => void;
}> = ({ initialValue = null, onObservedChange }) => {
  const [val, setVal] = React.useState<number | null>(initialValue);
  return (
    <CurrencyInput
      aria-label="Nominal Uang"
      value={val}
      onValueChange={(next) => {
        setVal(next);
        onObservedChange?.(next);
      }}
    />
  );
};

describe("CurrencyInput (react-number-format v5.4.5)", () => {
  it("formats typed digits with Rp prefix and dot thousands, emitting integer number", async () => {
    const user = userEvent.setup();
    const observed: Array<number | null> = [];
    render(<ControlledCurrencyHarness onObservedChange={(v) => observed.push(v)} />);

    const input = screen.getByLabelText("Nominal Uang") as HTMLInputElement;
    await user.type(input, "1500000");

    expect(input.value).toBe("Rp 1.500.000");
    const lastVal = observed[observed.length - 1];
    expect(lastVal).toBe(1500000);
    expect(typeof lastVal).toBe("number");
  });

  it("emits null when cleared", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(val: number | null) => void>();
    render(<ControlledCurrencyHarness initialValue={250000} onObservedChange={onChange} />);

    const input = screen.getByLabelText("Nominal Uang") as HTMLInputElement;
    expect(input.value).toBe("Rp 250.000");

    await user.clear(input);
    expect(input.value).toBe("");
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("handles pasting 'Rp 1.500.000' and '1500000' into integer value", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(val: number | null) => void>();
    render(<ControlledCurrencyHarness onObservedChange={onChange} />);

    const input = screen.getByLabelText("Nominal Uang") as HTMLInputElement;
    await user.click(input);
    await user.paste("Rp 1.500.000");

    expect(input.value).toBe("Rp 1.500.000");
    expect(onChange).toHaveBeenLastCalledWith(1500000);

    await user.clear(input);
    await user.paste("1500000");
    expect(input.value).toBe("Rp 1.500.000");
    expect(onChange).toHaveBeenLastCalledWith(1500000);
  });

  it("supports editing in the middle of an existing number", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(val: number | null) => void>();
    render(<ControlledCurrencyHarness initialValue={15000} onObservedChange={onChange} />);

    const input = screen.getByLabelText("Nominal Uang") as HTMLInputElement;
    expect(input.value).toBe("Rp 15.000");

    await user.click(input);
    // Position cursor right after "Rp 1" (index 4) and insert "2" -> 125.000
    input.setSelectionRange(4, 4);
    await user.keyboard("2");

    expect(input.value).toBe("Rp 125.000");
    expect(onChange).toHaveBeenLastCalledWith(125000);
  });

  it("enforces 15-digit maximum limit (999.999.999.999.999) and blocks 16th digit", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(val: number | null) => void>();
    render(<ControlledCurrencyHarness onObservedChange={onChange} />);

    const input = screen.getByLabelText("Nominal Uang") as HTMLInputElement;
    await user.type(input, "9999999999999998");

    expect(input.value).toBe("Rp 999.999.999.999.999");
    expect(onChange).toHaveBeenLastCalledWith(999_999_999_999_999);
  });

  it("rejects negative sign and decimal inputs", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(val: number | null) => void>();
    render(<ControlledCurrencyHarness onObservedChange={onChange} />);

    const input = screen.getByLabelText("Nominal Uang") as HTMLInputElement;
    await user.type(input, "-500,75");

    expect(input.value).toBe("Rp 50.075");
    for (const call of onChange.mock.calls) {
      const arg = call[0];
      expect(arg === null || (typeof arg === "number" && Number.isInteger(arg) && arg >= 0)).toBe(
        true
      );
    }
  });

  it("integrates with react-hook-form Controller", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<(data: { amount: number | null }) => void>();

    const FormWrapper: React.FC = () => {
      const { control, handleSubmit } = useForm<{ amount: number | null }>({
        defaultValues: { amount: null },
      });
      return (
        <form onSubmit={handleSubmit(onSubmit)}>
          <Controller
            name="amount"
            control={control}
            render={({ field }) => (
              <CurrencyInput
                aria-label="Input RHF"
                value={field.value}
                onValueChange={field.onChange}
                onBlur={field.onBlur}
                ref={field.ref}
              />
            )}
          />
          <button type="submit">Simpan</button>
        </form>
      );
    };

    render(<FormWrapper />);
    const input = screen.getByLabelText("Input RHF");
    await user.type(input, "750000");
    await user.click(screen.getByRole("button", { name: "Simpan" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toEqual({ amount: 750000 });
  });

  it("opens bottom calculator drawer and computes +, -, ×, ÷, =, and Selesai", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(val: number | null) => void>();
    render(<ControlledCurrencyHarness onObservedChange={onChange} />);

    const input = screen.getByLabelText("Nominal Uang") as HTMLInputElement;
    await user.click(input);

    // Drawer should be visible
    const drawer = screen.getByTestId("currency-calculator-drawer");
    expect(drawer).toBeInTheDocument();

    // Tap 5, 000 -> 5.000
    await user.click(screen.getByTestId("calc-key-5"));
    await user.click(screen.getByTestId("calc-key-000"));
    expect(input.value).toBe("Rp 5.000");
    expect(onChange).toHaveBeenLastCalledWith(5000);

    // Tap + 2, 5, 0, 0, 0 -> 5.000 + 25.000 = 30.000
    await user.click(screen.getByTestId("calc-key-add"));
    await user.click(screen.getByTestId("calc-key-2"));
    await user.click(screen.getByTestId("calc-key-5"));
    await user.click(screen.getByTestId("calc-key-000"));
    expect(screen.getByTestId("calc-expression-display")).toHaveTextContent(
      "5.000 + 25.000"
    );
    expect(input.value).toBe("Rp 30.000");
    expect(onChange).toHaveBeenLastCalledWith(30000);

    // Tap = to collapse expression to 30.000
    await user.click(screen.getByTestId("calc-key-eq"));
    expect(screen.getByTestId("calc-expression-display")).toHaveTextContent("30.000");
    expect(input.value).toBe("Rp 30.000");

    // Tap × 2 - 10.000 / 2 -> 30.000 * 2 - 5.000 = 55.000
    await user.click(screen.getByTestId("calc-key-mul"));
    await user.click(screen.getByTestId("calc-key-2"));
    await user.click(screen.getByTestId("calc-key-sub"));
    await user.click(screen.getByTestId("calc-key-1"));
    await user.click(screen.getByTestId("calc-key-0"));
    await user.click(screen.getByTestId("calc-key-000"));
    await user.click(screen.getByTestId("calc-key-div"));
    await user.click(screen.getByTestId("calc-key-2"));

    expect(input.value).toBe("Rp 55.000");
    expect(onChange).toHaveBeenLastCalledWith(55000);

    // Tap Selesai (checklist) to finalize and close drawer
    await user.click(screen.getByTestId("calc-key-done"));
    expect(input.value).toBe("Rp 55.000");
    expect(onChange).toHaveBeenLastCalledWith(55000);
    expect(screen.queryByTestId("currency-calculator-drawer")).not.toBeInTheDocument();
  });

  describe("touch virtual keyboard suppression", () => {
    const originalMatchMedia = window.matchMedia;

    afterEach(() => {
      window.matchMedia = originalMatchMedia;
    });

    const mockCoarsePointer = (matches: boolean) => {
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: query === "(pointer: coarse)" ? matches : false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));
    };

    it("renders readOnly with inputMode='none' on coarse-pointer devices, blurs on tap/Rp-prefix mouseup, and still calculates via drawer", () => {
      mockCoarsePointer(true);
      const onChange = vi.fn<(val: number | null) => void>();
      const CoarseHarness: React.FC = () => {
        const [val, setVal] = React.useState<number | null>(50000);
        return (
          <div>
            <input aria-label="Catatan" />
            <label htmlFor="nominal-coarse">Nominal</label>
            <CurrencyInput
              id="nominal-coarse"
              aria-label="Nominal Uang"
              value={val}
              onValueChange={(next) => {
                setVal(next);
                onChange(next);
              }}
            />
          </div>
        );
      };
      render(<CoarseHarness />);

      const noteInput = screen.getByLabelText("Catatan") as HTMLInputElement;
      noteInput.focus();
      expect(document.activeElement).toBe(noteInput);

      const input = screen.getByLabelText("Nominal Uang") as HTMLInputElement;
      expect(input).toHaveAttribute("readonly");
      expect(input).toHaveAttribute("inputmode", "none");

      // Simulate mobile tap hitting the "Rp " prefix (index 0), focusing, releasing, and clicking
      fireEvent.touchStart(input);
      input.focus();
      input.setSelectionRange(0, 0);
      fireEvent.mouseUp(input);
      fireEvent.click(input);

      // Should dismiss focus from previous input and never keep CurrencyInput focused
      expect(document.activeElement).not.toBe(noteInput);
      expect(document.activeElement).not.toBe(input);

      expect(screen.getByTestId("currency-calculator-drawer")).toBeInTheDocument();

      fireEvent.touchStart(screen.getByTestId("calc-key-add"));
      fireEvent.click(screen.getByTestId("calc-key-add"));
      fireEvent.touchStart(screen.getByTestId("calc-key-5"));
      fireEvent.click(screen.getByTestId("calc-key-5"));
      fireEvent.touchStart(screen.getByTestId("calc-key-000"));
      fireEvent.click(screen.getByTestId("calc-key-000"));
      fireEvent.touchStart(screen.getByTestId("calc-key-done"));
      fireEvent.click(screen.getByTestId("calc-key-done"));

      expect(input.value).toBe("Rp 55.000");
      expect(onChange).toHaveBeenLastCalledWith(55000);
      expect(document.activeElement).not.toBe(input);
    });

    it("switches dynamically to touch readOnly on touchstart and restores desktop typing on mouse click", async () => {
      mockCoarsePointer(false);
      const user = userEvent.setup();
      const onChange = vi.fn<(val: number | null) => void>();
      render(<ControlledCurrencyHarness onObservedChange={onChange} />);

      const input = screen.getByLabelText("Nominal Uang") as HTMLInputElement;
      expect(input).not.toHaveAttribute("readonly");

      // Touch tap on 2-in-1 / hybrid device activates touch protection synchronously
      fireEvent.touchStart(input);
      expect(input.readOnly).toBe(true);
      input.focus();
      fireEvent.mouseUp(input);
      fireEvent.click(input);

      expect(document.activeElement).not.toBe(input);
      expect(screen.getByTestId("currency-calculator-drawer")).toBeInTheDocument();

      fireEvent.touchStart(screen.getByTestId("calc-key-done"));
      fireEvent.click(screen.getByTestId("calc-key-done"));
      expect(screen.queryByTestId("currency-calculator-drawer")).not.toBeInTheDocument();
      expect(input.readOnly).toBe(true);

      // Mouse interaction restores editable keyboard input
      await user.click(input);
      expect(input.readOnly).toBe(false);
      await user.type(input, "25000");
      expect(input.value).toBe("Rp 25.000");
      expect(onChange).toHaveBeenLastCalledWith(25000);
    });

    it("opens calculator without keeping input focused when tapping label on coarse-pointer device", () => {
      mockCoarsePointer(true);
      render(
        <div>
          <label htmlFor="nominal-label-test">Nominal Tap</label>
          <CurrencyInput
            id="nominal-label-test"
            value={null}
            onValueChange={vi.fn()}
          />
        </div>
      );

      const label = screen.getByText("Nominal Tap");
      const input = document.getElementById("nominal-label-test") as HTMLInputElement;
      expect(input.readOnly).toBe(true);

      fireEvent.touchStart(label);
      fireEvent.click(label);

      expect(document.activeElement).not.toBe(input);
      expect(screen.getByTestId("currency-calculator-drawer")).toBeInTheDocument();
    });
  });
});

