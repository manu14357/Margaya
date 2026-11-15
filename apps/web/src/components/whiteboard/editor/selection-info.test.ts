import { createElement } from "@margaya/whiteboard";
import { describe, expect, it } from "vitest";
import { sharedStyle, styleApplies, stylePatchFor } from "./selection-info";

describe("Style panel options on mixed selections", () => {
  const rect = createElement("rectangle", {
    strokeWidth: 4,
    fillColor: "#a5d8ff",
  });
  const sticky = createElement("sticky", { fillColor: "#fff3bf" });
  const text = createElement("text", { text: "hi" });
  const drawing = createElement("draw", { strokeWidth: 4 });

  it("reads an option only from the elements it applies to", () => {
    // The text has no outline and the sticky's fill is its note colour.
    expect(sharedStyle([rect, text, sticky], "strokeWidth")).toBe(4);
    expect(sharedStyle([rect, sticky, text], "fillColor")).toBe("#a5d8ff");
    expect(sharedStyle([rect, drawing], "strokeWidth")).toBe(4);
    expect(sharedStyle([rect, drawing], "strokeStyle")).toBe(rect.strokeStyle);
    // A real difference still shows as mixed.
    expect(
      sharedStyle(
        [rect, createElement("ellipse", { strokeWidth: 1 })],
        "strokeWidth",
      ),
    ).toBeNull();
  });

  it("changes only the elements an option applies to", () => {
    expect(stylePatchFor(sticky, { fillColor: "#ffc9c9" })).toEqual({});
    expect(stylePatchFor(sticky, { strokeColor: "#2563eb" })).toEqual({});
    expect(stylePatchFor(rect, { fillColor: "#ffc9c9" })).toEqual({
      fillColor: "#ffc9c9",
    });
    expect(
      stylePatchFor(text, { strokeColor: "#2563eb", strokeWidth: 8 }),
    ).toEqual({ strokeColor: "#2563eb" });
    expect(stylePatchFor(sticky, { fontSize: 28, opacity: 50 })).toEqual({
      fontSize: 28,
      opacity: 50,
    });
    expect(styleApplies(drawing, "strokeStyle")).toBe(false);
    expect(styleApplies(rect, "cornerRadius")).toBe(true);
  });
});
