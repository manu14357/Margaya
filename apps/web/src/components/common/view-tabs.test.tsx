import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ViewTabs } from "./view-tabs";

afterEach(cleanup);

const tabs = ["Backlog", "Board", "List", "Calendar", "Analytics"].map(
  (name) => ({ value: name.toLowerCase(), label: name, onSelect: vi.fn() }),
);

function scrollerOf(root: HTMLElement) {
  const element = root.querySelector<HTMLElement>(
    '[data-slot="view-tabs-scroller"]',
  );
  if (!element) throw new Error("no scroller");
  return element;
}

// jsdom has no layout: give the row a 200px window onto 600px of tabs.
function overflowing(scroller: HTMLElement) {
  Object.defineProperty(scroller, "clientWidth", { value: 200 });
  Object.defineProperty(scroller, "scrollWidth", { value: 600 });
}

describe("ViewTabs", () => {
  it("scrolls the row sideways with a mouse wheel when the tabs overflow", () => {
    render(<ViewTabs tabs={tabs} value="board" label="Views" />);
    const scroller = scrollerOf(document.body);
    overflowing(scroller);

    fireEvent.wheel(scroller, { deltaY: 120, deltaX: 0 });
    expect(scroller.scrollLeft).toBe(120);

    // A sideways gesture (touchpad) is left to the browser.
    fireEvent.wheel(scroller, { deltaY: 2, deltaX: 40 });
    expect(scroller.scrollLeft).toBe(120);
  });

  it("brings the selected tab into view when it starts off screen", () => {
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.dataset.slot === "view-tabs-scroller")
          return { left: 0, right: 200, width: 200 } as DOMRect;
        if (this.textContent === "Analytics")
          return { left: 480, right: 570, width: 90 } as DOMRect;
        return { left: 0, right: 0, width: 0 } as DOMRect;
      });

    // The section tabs arrive after the first render (features load).
    const { rerender } = render(
      <ViewTabs tabs={tabs.slice(0, 2)} value="analytics" label="Views" />,
    );
    expect(scrollerOf(document.body).scrollLeft).toBe(0);
    rerender(<ViewTabs tabs={tabs} value="analytics" label="Views" />);

    // Its end (570) lines up with the row's end (200), with 16px to spare.
    expect(scrollerOf(document.body).scrollLeft).toBe(386);
    rect.mockRestore();
  });
});
