import { describe, expect, it } from "vitest";
import { chartIndexOf, chartKeyTarget } from "./navigation";

describe("chartKeyTarget", () => {
  it("moves along the chart's axis and stops at the ends", () => {
    expect(chartKeyTarget("ArrowRight", null, 3, "horizontal")).toBe(0);
    expect(chartKeyTarget("ArrowRight", 0, 3, "horizontal")).toBe(1);
    expect(chartKeyTarget("ArrowRight", 2, 3, "horizontal")).toBe(2);
    expect(chartKeyTarget("ArrowLeft", 0, 3, "horizontal")).toBe(0);
    expect(chartKeyTarget("ArrowDown", 1, 3, "vertical")).toBe(2);
    expect(chartKeyTarget("ArrowUp", 1, 3, "vertical")).toBe(0);
  });

  it("ignores the other axis", () => {
    expect(chartKeyTarget("ArrowDown", 0, 3, "horizontal")).toBeUndefined();
    expect(chartKeyTarget("ArrowRight", 0, 3, "vertical")).toBeUndefined();
    expect(chartKeyTarget("ArrowDown", 0, 3, "both")).toBe(1);
    expect(chartKeyTarget("ArrowLeft", 1, 3, "both")).toBe(0);
  });

  it("jumps with Home and End", () => {
    expect(chartKeyTarget("Home", 2, 5, "horizontal")).toBe(0);
    expect(chartKeyTarget("End", 0, 5, "horizontal")).toBe(4);
  });

  it("hides with Escape, and lets it bubble when nothing is shown", () => {
    expect(chartKeyTarget("Escape", 1, 3, "horizontal")).toBeNull();
    expect(chartKeyTarget("Escape", null, 3, "horizontal")).toBeUndefined();
  });

  it("handles nothing in an empty chart or for other keys", () => {
    expect(chartKeyTarget("ArrowRight", null, 0, "horizontal")).toBeUndefined();
    expect(chartKeyTarget("Enter", 0, 3, "horizontal")).toBeUndefined();
  });
});

describe("chartIndexOf", () => {
  it("reads the index of the closest hover target", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const band = document.createElementNS("http://www.w3.org/2000/svg", "g");
    band.setAttribute("data-chart-index", "3");
    const mark = document.createElementNS("http://www.w3.org/2000/svg", "path");
    band.append(mark);
    svg.append(band);
    expect(chartIndexOf(mark)).toBe(3);
    expect(chartIndexOf(svg)).toBeNull();
    expect(chartIndexOf(null)).toBeNull();
  });
});
