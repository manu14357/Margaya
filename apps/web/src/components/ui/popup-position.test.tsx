import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

afterEach(cleanup);

// A positioner starts at the top left corner of the page until its anchor is
// measured. If it animated `top`, `left` or `transform`, a popup placed after
// its first frame (a virtual anchor, a popup rendered already open, a quick
// reopen) would slide across the screen to its spot instead of appearing
// there. The popup itself still fades and scales in place.
const animatesPosition =
  /transition-\[[^\]]*\b(top|left|right|bottom|transform)\b/;

describe("popup positioners", () => {
  it("place a popover without animating it into position", () => {
    render(
      <Popover open>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent>Body</PopoverContent>
      </Popover>,
    );
    const positioner = document.querySelector("[data-slot=popover-positioner]");
    expect(positioner).not.toBeNull();
    expect(positioner?.className).not.toMatch(animatesPosition);
  });

  it("place a tooltip without animating it into position", () => {
    render(
      <Tooltip open>
        <TooltipTrigger>Hover</TooltipTrigger>
        <TooltipContent>Tip</TooltipContent>
      </Tooltip>,
    );
    const positioner = document.querySelector("[data-slot=tooltip-positioner]");
    expect(positioner).not.toBeNull();
    expect(positioner?.className).not.toMatch(animatesPosition);
  });
});
