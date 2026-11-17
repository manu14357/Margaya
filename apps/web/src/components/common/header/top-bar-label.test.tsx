import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { type TopBarDensity, TopBarDensityProvider } from "./top-bar-density";
import { TopBarLabel } from "./top-bar-label";

afterEach(cleanup);

function Bar({ density, title }: { density: TopBarDensity; title?: string }) {
  return (
    <TopBarDensityProvider value={density}>
      <button type="button" title={title}>
        <svg aria-hidden="true" />
        <TopBarLabel className="hidden sm:inline">New cycle</TopBarLabel>
      </button>
    </TopBarDensityProvider>
  );
}

describe("TopBarLabel", () => {
  it("shows the label while the bar has room, with no extra tooltip", () => {
    render(<Bar density="full" />);
    const button = screen.getByRole("button", { name: "New cycle" });
    expect(button).not.toHaveAttribute("title");
    expect(screen.getByText("New cycle")).toHaveClass("hidden", "sm:inline");
  });

  it("turns an icon-only button's hidden label into its tooltip", () => {
    const { rerender } = render(<Bar density="compact" />);
    const button = screen.getByRole("button", { name: "New cycle" });
    expect(screen.getByText("New cycle")).toHaveClass("sr-only");
    expect(button).toHaveAttribute("title", "New cycle");

    // Back to a roomy bar: the label shows again and the tooltip goes.
    rerender(<Bar density="full" />);
    expect(button).not.toHaveAttribute("title");
  });

  it("leaves a control's own tooltip alone", () => {
    const { rerender } = render(<Bar density="tight" title="Plan a cycle" />);
    const button = screen.getByRole("button", { name: "New cycle" });
    expect(button).toHaveAttribute("title", "Plan a cycle");
    rerender(<Bar density="full" title="Plan a cycle" />);
    expect(button).toHaveAttribute("title", "Plan a cycle");
  });
});
