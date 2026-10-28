import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
});

