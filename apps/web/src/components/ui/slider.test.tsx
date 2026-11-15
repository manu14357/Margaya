import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Slider } from "./slider";

afterEach(cleanup);

// jsdom does not map the range input to the "slider" role, so these check
// the focusable input directly: that is the element screen readers name.
function rangeInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector("input");
  if (!input) throw new Error("No slider input rendered");
  return input;
}

describe("Slider", () => {
  it("puts aria-label on the focusable input, not only on the group", () => {
    const { container } = render(
      <Slider aria-label="Opacity" min={0} max={100} value={50} />,
    );
    expect(rangeInput(container).getAttribute("aria-label")).toBe("Opacity");
  });

  it("still names the input through aria-labelledby", () => {
    const { container } = render(
      <>
        <span id="spacing-label">Spacing</span>
        <Slider aria-labelledby="spacing-label" min={0} max={2} value={1} />
      </>,
    );
    expect(rangeInput(container).getAttribute("aria-labelledby")).toContain(
      "spacing-label",
    );
  });
});
