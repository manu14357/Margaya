import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LabelChip, LabelChips } from "./label-chips";

afterEach(cleanup);

describe("LabelChip", () => {
  it("keeps the chip neutral and shows the label's colour only in its dot", () => {
    const { container } = render(
      <LabelChip label={{ id: "1", name: "Bug", color: "#ff0000" }} />,
    );

    const chip = container.firstElementChild as HTMLElement;
    expect(chip.getAttribute("style")).toBeNull();
    expect(chip).toHaveClass("bg-muted/55", "text-foreground");

    const dot = chip.querySelector("[aria-hidden]") as HTMLElement;
    expect(dot).toHaveClass("size-2");
    expect(dot.style.backgroundColor).toBe("rgb(255, 0, 0)");
    expect(screen.getByText("Bug")).toBeInTheDocument();
  });
});

describe("LabelChips", () => {
  it("shows at most `max` chips, then a count", () => {
    const labels = ["a", "b", "c"].map((id) => ({
      id,
      name: id,
      color: "#00ff00",
    }));

    render(<LabelChips labels={labels} max={2} />);

    expect(screen.queryByText("c")).toBeNull();
    expect(screen.getByText("+1")).toBeInTheDocument();
  });
});
