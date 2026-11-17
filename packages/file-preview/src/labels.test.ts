import { describe, expect, it } from "vitest";
import { DEFAULT_LABELS, formatLabel, resolveLabels } from "./labels";

describe("labels", () => {
  it("defaults to English", () => {
    expect(resolveLabels()).toBe(DEFAULT_LABELS);
    expect(resolveLabels(undefined).download).toBe("Download");
    for (const value of Object.values(DEFAULT_LABELS)) {
      expect(value.trim().length).toBeGreaterThan(0);
    }
  });

  it("overlays the host's translations and ignores empty ones", () => {
    const labels = resolveLabels({ download: "Herunterladen", zoomIn: "" });
    expect(labels.download).toBe("Herunterladen");
    expect(labels.zoomIn).toBe(DEFAULT_LABELS.zoomIn);
    expect(labels.find).toBe(DEFAULT_LABELS.find);
  });

  it("fills placeholders and keeps unknown ones", () => {
    expect(formatLabel("{current} of {total}", { current: 2, total: 9 })).toBe(
      "2 of 9",
    );
    expect(formatLabel("Page {page} {other}", { page: 3 })).toBe(
      "Page 3 {other}",
    );
  });
});
