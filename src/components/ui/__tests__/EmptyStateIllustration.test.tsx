import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  EmptyStateIllustration,
  type EmptyStateVariant,
} from "../EmptyStateIllustration";

describe("EmptyStateIllustration", () => {
  const variants: EmptyStateVariant[] = [
    "monthly-history",
    "recent-transactions",
    "monthly-budget",
    "transaction-filter",
    "category-filter",
    "active-budget-period",
  ];

  it.each(variants)(
    "renders adaptive light/dark SVG illustration for %s variant",
    (variant) => {
      render(<EmptyStateIllustration variant={variant} />);
      const svg = screen.getByTestId(`empty-illustration-${variant}`);
      expect(svg).toBeInTheDocument();
      expect(svg.tagName.toLowerCase()).toBe("svg");
      expect(svg).toHaveAttribute("aria-hidden", "true");
      expect(svg.innerHTML).toContain("dark:");
    }
  );
});

