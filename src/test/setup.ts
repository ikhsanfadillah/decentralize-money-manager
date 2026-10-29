import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";
import * as React from "react";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ children, to, ...props }: any) =>
      React.createElement(
        "a",
        { href: typeof to === "string" ? to : "#", ...props },
        children
      ),
    useNavigate: () => vi.fn(),
    useRouter: () => ({
      state: { location: { pathname: "/" } },
      navigate: vi.fn(),
    }),
  };
});
