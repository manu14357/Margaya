import { describe, expect, it } from "vitest";
import { shortcutKey } from "./shortcut-key";

describe("shortcutKey", () => {
  it("lower-cases Latin letters and keeps symbols and named keys", () => {
    expect(shortcutKey({ key: "G", code: "KeyG" })).toBe("g");
    expect(shortcutKey({ key: "?", code: "Slash" })).toBe("?");
    expect(shortcutKey({ key: "!", code: "Digit1" })).toBe("!");
    expect(shortcutKey({ key: "Enter", code: "Enter" })).toBe("Enter");
  });

  it("falls back to the physical key on ru and el layouts", () => {
    expect(shortcutKey({ key: "п", code: "KeyG" })).toBe("g");
    expect(shortcutKey({ key: "Ж", code: "Semicolon" })).toBe("ж");
    expect(shortcutKey({ key: "γ", code: "KeyG" })).toBe("g");
    expect(shortcutKey({ key: "Σ", code: "KeyS" })).toBe("s");
  });

  it("keeps Latin layouts on the typed key", () => {
    // AZERTY: "a" on KeyQ, "z" on KeyW.
    expect(shortcutKey({ key: "a", code: "KeyQ" })).toBe("a");
    expect(shortcutKey({ key: "z", code: "KeyW" })).toBe("z");
  });
});
