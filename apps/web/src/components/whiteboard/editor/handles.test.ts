import { type BoardElement, createElement } from "@margaya/whiteboard";
import { describe, expect, it } from "vitest";
import { draggedEdges, resizeKeepsAspect } from "./handles";

const rect = (props: Record<string, unknown> = {}) =>
  createElement("rectangle", { x: 0, y: 0, width: 100, height: 50, ...props });

describe("resizeKeepsAspect", () => {
  it("keeps one image's or text's proportions unless Shift frees them", () => {
    const image = [createElement("image", { assetId: "a" }) as BoardElement];
    expect(resizeKeepsAspect(image, "se", false)).toBe(true);
    expect(resizeKeepsAspect(image, "se", true)).toBe(false);
    expect(resizeKeepsAspect([rect()], "se", false)).toBe(false);
    expect(resizeKeepsAspect([rect()], "se", true)).toBe(true);
  });

  it("scales a text from a corner but lets its sides set the wrap width", () => {
    const text = [createElement("text", { text: "Hello" }) as BoardElement];
    expect(resizeKeepsAspect(text, "se", false)).toBe(true);
    expect(resizeKeepsAspect(text, "e", false)).toBe(false);
    expect(resizeKeepsAspect(text, "w", false)).toBe(false);
  });

  it("scales a group like a picture from a corner but stretches it from a side", () => {
    const group = [rect({ groupIds: ["g"] }), rect({ groupIds: ["g"] })];
    expect(resizeKeepsAspect(group, "se", false)).toBe(true);
    expect(resizeKeepsAspect(group, "nw", false)).toBe(true);
    expect(resizeKeepsAspect(group, "e", false)).toBe(false);
    expect(resizeKeepsAspect(group, "n", true)).toBe(true);
  });

  it("lets loose shapes stretch from a corner, Shift keeps them even", () => {
    const loose = [rect(), rect({ x: 200 })];
    expect(resizeKeepsAspect(loose, "se", false)).toBe(false);
    expect(resizeKeepsAspect(loose, "se", true)).toBe(true);
  });

  it("never stretches turned boxes, which would shear them", () => {
    const turned = [rect({ angle: 0.5 }), rect({ x: 200 })];
    expect(resizeKeepsAspect(turned, "e", false)).toBe(true);
    // A drawing carries its turn in its points and may stretch.
    const drawing = createElement("draw", {
      points: [
        [0, 0],
        [10, 10],
      ],
      angle: 0.5,
    }) as BoardElement;
    expect(resizeKeepsAspect([drawing, rect({ x: 200 })], "e", false)).toBe(
      false,
    );
  });
});

describe("draggedEdges", () => {
  const frame = { x: 10, y: 20, width: 100, height: 50, angle: 0 };

  it("names the sides a handle moves", () => {
    expect(draggedEdges(frame, "se")).toEqual({ x: 110, y: 70 });
    expect(draggedEdges(frame, "nw")).toEqual({ x: 10, y: 20 });
    expect(draggedEdges(frame, "e")).toEqual({ x: 110, y: null });
    expect(draggedEdges(frame, "n")).toEqual({ x: null, y: 20 });
  });
});
