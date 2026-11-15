import { DEFAULT_BOARD_SETTINGS } from "@margaya/whiteboard";
import { describe, expect, it } from "vitest";
import { visiblePattern } from "./controller";

describe("visiblePattern", () => {
  it("draws nothing on a plain board without snapping", () => {
    expect(visiblePattern(DEFAULT_BOARD_SETTINGS)).toEqual({
      pattern: "plain",
      patternSize: 24,
    });
  });

  it("shows the snap grid on a plain board with snapping on", () => {
    expect(visiblePattern({ ...DEFAULT_BOARD_SETTINGS, gridSize: 20 })).toEqual(
      { pattern: "grid", patternSize: 20 },
    );
  });

  it("keeps the chosen pattern when one is set, snapping or not", () => {
    expect(
      visiblePattern({
        ...DEFAULT_BOARD_SETTINGS,
        pattern: "dots",
        patternSize: 40,
        gridSize: 20,
      }),
    ).toEqual({ pattern: "dots", patternSize: 40 });
  });
});
