import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { InteractiveCashFlowChart } from "../InteractiveCashFlowChart";
import type { DailyCashFlowPoint } from "../../../lib/tauri-api";

function buildMockSeries(daysInMonth = 30): DailyCashFlowPoint[] {
  let cumIncome = 0;
  let cumExpense = 0;

  return Array.from({ length: daysInMonth }, (_, idx) => {
    const day = idx + 1;
    const income = day === 6 ? 10_000_000 : day === 1 ? 2_000_000 : 0;
    const expense = day === 6 ? 9_050_000 : day === 10 ? 500_000 : 0;
    cumIncome += income;
    cumExpense += expense;

    return {
      date: `2026-11-${String(day).padStart(2, "0")}`,
      day,
      income,
      expense,
      net: income - expense,
      cumulative_income: cumIncome,
      cumulative_expense: cumExpense,
      tx_count: day === 6 ? 3 : day === 1 || day === 10 ? 1 : 0,
    };
  });
}

describe("InteractiveCashFlowChart", () => {
  it("renders a single unified HUD readout without floating in-canvas tooltips and allows selecting & clearing a date", async () => {
    const user = userEvent.setup();
    const series = buildMockSeries(30);

    const Harness: React.FC = () => {
      const [selectedDate, setSelectedDate] = React.useState<string | null>(
        null
      );
      return (
        <InteractiveCashFlowChart
          dailySeries={series}
          daysInMonth={30}
          elapsedDays={9}
          totalBudgetLimit={12_000_000}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
        />
      );
    };

    const { container } = render(<Harness />);

    // Only a single HUD element should exist, and no floating overlay pill inside the SVG plot
    expect(screen.getAllByTestId("cashflow-hud-readout")).toHaveLength(1);
    expect(
      container.querySelector('[data-floating-surface="true"]')
    ).not.toBeInTheDocument();

    // Select day 6 via interactive day group
    await user.click(screen.getByTestId("cashflow-day-group-6"));

    const hud = screen.getByTestId("cashflow-hud-readout");
    expect(hud).toHaveTextContent("Jumat, 6 November 2026");
    expect(hud).toHaveTextContent("3 transaksi");
    expect(hud).toHaveTextContent("+Rp 10.000.000");
    expect(hud).toHaveTextContent("−Rp 9.050.000");

    // Selected state exposes Rincian drilldown button and clear button
    expect(screen.getByRole("button", { name: /Rincian/i })).toBeInTheDocument();
    const clearBtn = screen.getByRole("button", {
      name: "Hapus filter tanggal",
    });
    await user.click(clearBtn);

    expect(
      screen.queryByRole("button", { name: "Hapus filter tanggal" })
    ).not.toBeInTheDocument();
  });

  it("toggles series visibility and switches between 1 Bulan and 2 Minggu pan footer", async () => {
    const user = userEvent.setup();
    const series = buildMockSeries(30);

    render(
      <InteractiveCashFlowChart
        dailySeries={series}
        daysInMonth={30}
        elapsedDays={9}
        totalBudgetLimit={12_000_000}
        selectedDate={null}
        onSelectDate={vi.fn()}
      />
    );

    // Initially in 1 Bulan mode -> pan footer should not be shown
    expect(screen.queryByTestId("cashflow-pan-footer")).not.toBeInTheDocument();

    // Toggle series buttons expose aria-pressed state
    const incomeBtn = screen.getByRole("button", { name: "Pemasukan" });
    const expenseBtn = screen.getByRole("button", { name: "Pengeluaran" });
    const surplusBtn = screen.getByRole("button", { name: "Surplus" });

    expect(incomeBtn).toHaveAttribute("aria-pressed", "true");
    expect(expenseBtn).toHaveAttribute("aria-pressed", "true");
    expect(surplusBtn).toHaveAttribute("aria-pressed", "true");

    await user.click(surplusBtn);
    expect(surplusBtn).toHaveAttribute("aria-pressed", "false");

    // Switch to 2 Minggu mode -> shows pan footer with Tgl 1–15 / Tgl 16–30
    await user.click(screen.getByRole("button", { name: "Skala 2 Minggu" }));
    const panFooter = screen.getByTestId("cashflow-pan-footer");
    expect(panFooter).toBeInTheDocument();
    expect(panFooter).toHaveTextContent("Tgl 1–15");
    expect(panFooter).toHaveTextContent("Tgl 16–30");

    // Switch to Akumulasi & Laju Anggaran mode
    await user.click(
      screen.getByRole("button", { name: "Akumulasi & Laju Anggaran" })
    );
    expect(screen.getByTestId("cashflow-hud-readout")).toHaveTextContent(
      "Kumulatif Keluar:"
    );
    expect(screen.getByTestId("cashflow-hud-readout")).toHaveTextContent(
      "Target:"
    );
  });

  it("renders a graceful empty state when dailySeries is empty", () => {
    render(
      <InteractiveCashFlowChart
        dailySeries={[]}
        daysInMonth={30}
        elapsedDays={0}
        totalBudgetLimit={null}
        selectedDate={null}
        onSelectDate={vi.fn()}
      />
    );

    expect(
      screen.getByText("Belum ada data arus kas pada bulan ini.")
    ).toBeInTheDocument();
  });
});

