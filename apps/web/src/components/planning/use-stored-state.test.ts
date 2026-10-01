import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { isBooleanRecord, useStoredState } from "./use-stored-state";

const isTab = (value: unknown) => value === "a" || value === "b";

afterEach(() => {
  window.localStorage.clear();
});

describe("useStoredState", () => {
  it("starts from the stored value and saves updates", () => {
    window.localStorage.setItem("test:tab", JSON.stringify("b"));
    const { result } = renderHook(() => useStoredState("test:tab", "a", isTab));
    expect(result.current[0]).toBe("b");

    act(() => result.current[1]("a"));
    expect(result.current[0]).toBe("a");
    expect(window.localStorage.getItem("test:tab")).toBe('"a"');
  });

  it("falls back on a missing, invalid or unreadable value", () => {
    const { result, rerender } = renderHook(
      ({ key }) => useStoredState(key, "a", isTab),
      { initialProps: { key: "test:missing" } },
    );
    expect(result.current[0]).toBe("a");

    window.localStorage.setItem("test:invalid", JSON.stringify("z"));
    rerender({ key: "test:invalid" });
    expect(result.current[0]).toBe("a");

    window.localStorage.setItem("test:corrupt", "{not json");
    rerender({ key: "test:corrupt" });
    expect(result.current[0]).toBe("a");
  });

  it("re-reads when the key changes", () => {
    window.localStorage.setItem("test:one", JSON.stringify("b"));
    const { result, rerender } = renderHook(
      ({ key }) => useStoredState(key, "a", isTab),
      { initialProps: { key: "test:two" } },
    );
    expect(result.current[0]).toBe("a");
    rerender({ key: "test:one" });
    expect(result.current[0]).toBe("b");
  });
});

describe("isBooleanRecord", () => {
  it("accepts flags keyed by name only", () => {
    expect(isBooleanRecord({ active: true, done: false })).toBe(true);
    expect(isBooleanRecord({})).toBe(true);
    expect(isBooleanRecord({ active: "yes" })).toBe(false);
    expect(isBooleanRecord([true])).toBe(false);
    expect(isBooleanRecord(null)).toBe(false);
    expect(isBooleanRecord(true)).toBe(false);
  });
});
