import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LayoutToggle from "./layout-toggle";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(cleanup);

describe("LayoutToggle", () => {
  it("keeps a name on each segment when its text is hidden on small screens", () => {
    const onChange = vi.fn();
    render(
      <LayoutToggle
        layouts={["list", "board"]}
        value="list"
        onChange={onChange}
      />,
    );
    expect(
      screen.getByRole("group", { name: "tasks:view.layout" }),
    ).toHaveAttribute("data-slot", "toggle-group");
    expect(
      screen.getByRole("button", { name: "tasks:view.list" }),
    ).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "tasks:view.board" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("board");
  });
});
