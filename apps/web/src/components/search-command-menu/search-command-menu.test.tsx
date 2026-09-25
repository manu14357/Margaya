import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SearchCommandMenu from "./index";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/use-keyboard-shortcuts", () => ({
  useRegisterShortcuts: () => {},
  getModifierKeyText: () => "Ctrl",
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "w1" } }),
}));
vi.mock("@/hooks/queries/search/use-global-search", () => ({
  // The API matches task keys, so "WEB-2" returns the task first.
  default: ({ q }: { q: string }) => ({
    data:
      q.trim().length >= 3
        ? {
            results: [
              {
                id: "t2",
                title: "Fix login redirect loop",
                type: "task",
                projectId: "p1",
                projectSlug: "WEB",
                taskNumber: 2,
              },
            ],
          }
        : undefined,
  }),
}));

afterEach(cleanup);

describe("SearchCommandMenu", () => {
  it("lists a task the server matched by its key", () => {
    render(<SearchCommandMenu open setOpen={vi.fn()} />);
    fireEvent.change(
      screen.getByPlaceholderText("navigation:search.inputPlaceholder"),
      { target: { value: "WEB-2" } },
    );

    expect(
      screen.getByRole("option", { name: "task: Fix login redirect loop" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("navigation:commandPalette.empty"),
    ).not.toBeInTheDocument();
  });
});
