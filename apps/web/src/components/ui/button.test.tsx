import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Button, touchSizeClass } from "./button";
import { Switch } from "./switch";
import { Tabs, TabsList, TabsTab } from "./tabs";

afterEach(cleanup);

describe("touchSizeClass", () => {
  it("keeps the phone size on touch screens for every size", () => {
    expect(touchSizeClass(undefined)).toBe("pointer-coarse:h-9");
    expect(touchSizeClass("xs")).toBe("pointer-coarse:h-7");
    expect(touchSizeClass("sm")).toBe("pointer-coarse:h-8");
    expect(touchSizeClass("icon-xs")).toBe("pointer-coarse:size-7");
    expect(touchSizeClass("icon-sm")).toBe("pointer-coarse:size-8");
    expect(touchSizeClass("icon")).toBe("pointer-coarse:size-9");
  });

  it("leaves a caller's own height or size alone", () => {
    expect(touchSizeClass("sm", "h-7 text-xs")).toBeUndefined();
    expect(touchSizeClass("icon-xs", "rounded-full size-5")).toBeUndefined();
    expect(touchSizeClass("xs", "sm:h-auto")).toBeUndefined();
    expect(touchSizeClass("xs", "pointer-coarse:h-11")).toBeUndefined();
  });

  it("does not mistake min sizes or arbitrary variants for a size", () => {
    expect(touchSizeClass("xs", "pointer-coarse:min-w-11 min-h-8")).toBe(
      "pointer-coarse:h-7",
    );
    expect(touchSizeClass("icon-xs", "[&_svg]:size-3")).toBe(
      "pointer-coarse:size-7",
    );
  });
});

describe("Button", () => {
  it("adds the touch size and keeps the mouse sizes", () => {
    render(<Button size="icon-xs" aria-label="Refresh" />);
    const button = screen.getByRole("button", { name: "Refresh" });
    expect(button).toHaveClass("size-7", "sm:size-6", "pointer-coarse:size-7");
    // The invisible 44px touch hit area.
    expect(button).toHaveClass(
      "pointer-coarse:after:min-h-11",
      "pointer-coarse:after:min-w-11",
    );
  });

  it("drops the touch size when the caller sizes the button", () => {
    render(
      <Button size="sm" className="h-7" aria-label="Copy">
        Copy
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Copy" });
    expect(button).toHaveClass("h-7");
    expect(button).not.toHaveClass("pointer-coarse:h-8");
  });
});

describe("TabsTab", () => {
  it("gives horizontal tabs a 44px touch target", () => {
    render(
      <Tabs value="a">
        <TabsList>
          <TabsTab value="a">All</TabsTab>
        </TabsList>
      </Tabs>,
    );
    const tab = screen.getByRole("tab", { name: "All" });
    expect(tab).toHaveClass(
      "data-[orientation=horizontal]:pointer-coarse:min-w-11",
      "data-[orientation=horizontal]:pointer-coarse:after:min-h-11",
    );
    expect(tab).toHaveAttribute("data-orientation", "horizontal");
  });
});

describe("Switch", () => {
  it("keeps the phone thumb size on touch screens", () => {
    render(<Switch aria-label="Milestone" />);
    expect(screen.getByRole("switch", { name: "Milestone" })).toHaveClass(
      "sm:[--thumb-size:--spacing(4)]",
      "pointer-coarse:[--thumb-size:--spacing(5)]",
    );
  });
});
