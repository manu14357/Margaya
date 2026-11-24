import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Switch } from "./switch";

afterEach(() => cleanup());

describe("Switch", () => {
  it("puts id and the label on the visible switch, not a hidden input", () => {
    const onCheckedChange = vi.fn();
    render(
      <>
        <label htmlFor="ai-features">AI features</label>
        <Switch id="ai-features" onCheckedChange={onCheckedChange} />
      </>,
    );

    const control = screen.getByRole("switch");
    expect(control.tagName).toBe("BUTTON");
    expect(control).toHaveAttribute("id", "ai-features");
    expect(control).toHaveAttribute("type", "button");
    expect(screen.getByLabelText("AI features")).toBe(control);
    expect(screen.getByRole("switch", { name: "AI features" })).toBe(control);

    fireEvent.click(screen.getByText("AI features"));
    expect(onCheckedChange).toHaveBeenCalledWith(true, expect.anything());
  });

  it("toggles from the switch itself and reports its state", () => {
    render(<Switch aria-label="Notifications" defaultChecked />);
    const control = screen.getByRole("switch", { name: "Notifications" });
    expect(control).toBeChecked();
    fireEvent.click(control);
    expect(control).not.toBeChecked();
  });
});
