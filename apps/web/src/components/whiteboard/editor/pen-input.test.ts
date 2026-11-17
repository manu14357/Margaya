import { describe, expect, it } from "vitest";
import { isPenEraser, PEN_GRACE_MS, touchPolicy } from "./pen-input";

describe("isPenEraser", () => {
  it("is the pen's eraser end or eraser button", () => {
    expect(isPenEraser({ pointerType: "pen", button: 5, buttons: 32 })).toBe(
      true,
    );
    // Held down during a move: only `buttons` says so.
    expect(isPenEraser({ pointerType: "pen", button: -1, buttons: 33 })).toBe(
      true,
    );
    expect(isPenEraser({ pointerType: "pen", button: 0, buttons: 1 })).toBe(
      false,
    );
  });

  it("never applies to a mouse or a finger", () => {
    expect(isPenEraser({ pointerType: "mouse", button: 5, buttons: 32 })).toBe(
      false,
    );
    expect(isPenEraser({ pointerType: "touch", button: 0, buttons: 32 })).toBe(
      false,
    );
  });
});

describe("touchPolicy", () => {
  const base = {
    penDown: false,
    lastPenAt: Number.NEGATIVE_INFINITY,
    now: 10_000,
    penOnly: false,
  };

  it("lets touch work normally when no pen is around", () => {
    expect(touchPolicy(base)).toBe("normal");
  });

  it("ignores touch while the pen is down", () => {
    expect(touchPolicy({ ...base, penDown: true })).toBe("ignore");
    expect(touchPolicy({ ...base, penDown: true, penOnly: true })).toBe(
      "ignore",
    );
  });

  it("ignores touch just after the pen hovered or lifted", () => {
    expect(touchPolicy({ ...base, lastPenAt: base.now - 100 })).toBe("ignore");
    expect(touchPolicy({ ...base, lastPenAt: base.now - PEN_GRACE_MS })).toBe(
      "normal",
    );
  });

  it("only pans and zooms with touch in pen-only mode", () => {
    expect(touchPolicy({ ...base, penOnly: true })).toBe("pan");
  });
});
