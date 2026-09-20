import { describe, expect, it } from "vitest";
import {
  createSaveEchoGuard,
  SAVE_ECHO_WINDOW_MS,
  sameFormValues,
} from "./form-autosave";

describe("sameFormValues", () => {
  it("compares every key and never matches null", () => {
    expect(sameFormValues({ a: "x", b: "" }, { a: "x", b: "" })).toBe(true);
    expect(sameFormValues({ a: "x", b: "" }, { a: "x", b: "y" })).toBe(false);
    expect(sameFormValues({ a: "x" }, null)).toBe(false);
  });
});

describe("createSaveEchoGuard", () => {
  it("accepts every snapshot while nothing was saved", () => {
    const guard = createSaveEchoGuard<{ name: string }>();
    expect(guard.accepts({ name: "a" })).toBe(true);
  });

  it("drops older snapshots until the saved values come back", () => {
    let time = 0;
    const guard = createSaveEchoGuard<{ name: string }>(() => time);
    guard.expect({ name: "new" });

    expect(guard.accepts({ name: "old" })).toBe(false);
    expect(guard.accepts({ name: "new" })).toBe(true);
    // Once echoed, other values are real changes made elsewhere.
    time = 1;
    expect(guard.accepts({ name: "changed by someone else" })).toBe(true);
  });

  it("stops waiting for the echo after the window", () => {
    let time = 0;
    const guard = createSaveEchoGuard<{ name: string }>(() => time);
    guard.expect({ name: "new" });
    time = SAVE_ECHO_WINDOW_MS;
    expect(guard.accepts({ name: "other" })).toBe(true);
  });
});
