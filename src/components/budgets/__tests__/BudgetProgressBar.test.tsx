import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BudgetProgressBar } from "../BudgetProgressBar";

describe("BudgetProgressBar", () => {
  it("renders modern spectrum gradient fill scaled to progress width and status label", () => {
    render(
      <BudgetProgressBar
        pct={65}
        status="OK"
        alertThresholdPct={80}
      />
    );

    const progressbar = screen.getByRole("progressbar");
    expect(progressbar).toHaveAttribute("aria-valuenow", "65");
    expect(progressbar).toHaveAttribute("aria-valuetext", "65%");

    const clip = screen.getByTestId("budget-gradient-clip");
    expect(clip).toHaveStyle({ width: "65%" });

    const fill = screen.getByTestId("budget-gradient-fill");
    expect(fill.style.backgroundImage).toContain("rgb(34, 197, 94)");
    expect(fill.style.backgroundImage).toContain("rgb(234, 179, 8)");
    expect(fill.style.backgroundImage).toContain("rgb(249, 115, 22)");
    expect(fill.style.backgroundImage).toContain("rgb(239, 68, 68)");
    expect(fill.style.backgroundImage).toContain("rgb(127, 29, 29)");

    expect(screen.getByTestId("budget-threshold-marker")).toHaveStyle({
      left: "80%",
    });
    const statusBadge = screen.getByTestId("budget-status-label-OK");
    expect(statusBadge).toHaveAttribute("aria-label", "Aman (Ok)");
    expect(statusBadge).toHaveTextContent("");
    expect(statusBadge.querySelector("svg")).toBeInTheDocument();
  });

  it("clamps over-100% usage to 100% track width and omits fill when 0%", () => {
    const { rerender } = render(
      <BudgetProgressBar
        pct={135}
        status="OVER"
        alertThresholdPct={80}
        tone="hero"
        showStatusLabel={false}
      />
    );

    expect(
      screen.queryByTestId("budget-status-label-OVER")
    ).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "100"
    );
    expect(screen.getByTestId("budget-gradient-clip")).toHaveStyle({
      width: "100%",
    });

    rerender(
      <BudgetProgressBar
        pct={0}
        status="OK"
        alertThresholdPct={0}
      />
    );

    expect(screen.queryByTestId("budget-gradient-clip")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("budget-threshold-marker")
    ).not.toBeInTheDocument();
  });
});
