import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShapePicker } from "./shape-picker";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => cleanup());

const buttons = () =>
  Array.from(
    document.querySelectorAll<HTMLButtonElement>("button[data-shape-choice]"),
  ).map((button) => button.dataset.shapeChoice);

describe("ShapePicker", () => {
  it("shows every shape in its groups, with the current one pressed", () => {
    render(<ShapePicker value="hexagon" onPick={vi.fn()} />);
    expect(buttons()).toHaveLength(25);
    expect(
      screen.getByRole("region", {
        name: "whiteboardEditor:shapes.groups.arrows",
      }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "whiteboardEditor:shapes.names.hexagon" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("filters by name and picks with a click or Enter", () => {
    const onPick = vi.fn();
    render(<ShapePicker value={null} onPick={onPick} />);
    const search = screen.getByRole("searchbox", {
      name: "whiteboardEditor:shapes.search",
    });
    fireEvent.change(search, { target: { value: "gon" } });
    expect(buttons()).toEqual(["pentagon", "hexagon", "octagon"]);
    fireEvent.click(
      screen.getByRole("button", {
        name: "whiteboardEditor:shapes.names.octagon",
      }),
    );
    expect(onPick).toHaveBeenLastCalledWith("octagon");
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onPick).toHaveBeenLastCalledWith("pentagon");
  });

  it("says so when nothing matches", () => {
    render(<ShapePicker value={null} onPick={vi.fn()} />);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "zzz" },
    });
    expect(buttons()).toEqual([]);
    expect(screen.getByText("whiteboardEditor:shapes.noResults")).toBeTruthy();
  });

  it("moves through the grid with the arrow keys", () => {
    render(<ShapePicker value={null} onPick={vi.fn()} />);
    const first = screen.getByRole("button", {
      name: "whiteboardEditor:tools.rectangle",
    });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(document.activeElement?.getAttribute("data-shape-choice")).toBe(
      "ellipse",
    );
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" });
    expect(document.activeElement?.getAttribute("data-shape-choice")).toBe(
      "trapezoid",
    );
  });
});
