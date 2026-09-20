import { describe, expect, it } from "vitest";
import {
  DEFAULT_GET_STARTED_STATE,
  getStartedStorageKey,
  readGetStartedState,
  writeGetStartedState,
} from "./get-started-storage";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

const throwingStorage = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

describe("get started storage", () => {
  it("reads the defaults when nothing is stored", () => {
    expect(readGetStartedState("ws-1", memoryStorage())).toEqual(
      DEFAULT_GET_STARTED_STATE,
    );
  });

  it("writes a change and reads it back, per workspace", () => {
    const storage = memoryStorage();
    writeGetStartedState("ws-1", { visitedAccount: true }, storage);
    const next = writeGetStartedState("ws-1", { hidden: true }, storage);

    expect(next).toEqual({
      hidden: true,
      visitedWorkspaceSettings: false,
      visitedAccount: true,
    });
    expect(readGetStartedState("ws-1", storage)).toEqual(next);
    expect(readGetStartedState("ws-2", storage)).toEqual(
      DEFAULT_GET_STARTED_STATE,
    );
    expect(storage.values.has(getStartedStorageKey("ws-1"))).toBe(true);
  });

  it("ignores malformed values", () => {
    const storage = memoryStorage();
    storage.setItem(getStartedStorageKey("ws-1"), "{not json");
    expect(readGetStartedState("ws-1", storage)).toEqual(
      DEFAULT_GET_STARTED_STATE,
    );
    storage.setItem(getStartedStorageKey("ws-1"), '{"hidden":"yes"}');
    expect(readGetStartedState("ws-1", storage).hidden).toBe(false);
  });

  it("ignores a throwing or missing storage", () => {
    expect(readGetStartedState("ws-1", throwingStorage)).toEqual(
      DEFAULT_GET_STARTED_STATE,
    );
    expect(
      writeGetStartedState("ws-1", { hidden: true }, throwingStorage),
    ).toEqual({ ...DEFAULT_GET_STARTED_STATE, hidden: true });
    expect(readGetStartedState("ws-1", null)).toEqual(
      DEFAULT_GET_STARTED_STATE,
    );
  });
});
