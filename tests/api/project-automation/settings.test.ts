import { describe, expect, it } from "vitest";
import {
  autoCloseState,
  DEFAULT_AUTOMATION_SETTINGS,
  hasAutomationChanges,
  mergeAutomationPatch,
} from "../../../apps/api/src/project-automation/settings";

const stored = {
  ...DEFAULT_AUTOMATION_SETTINGS,
  autoArchiveEnabled: true,
  autoArchiveMonths: 6,
  autoCloseEnabled: true,
  autoCloseMonths: 4,
  autoCloseColumnId: "col-cancelled",
};

describe("mergeAutomationPatch", () => {
  it("turns rules off but keeps their months and column", () => {
    const { next, changed } = mergeAutomationPatch(stored, {
      autoArchive: { enabled: false },
      autoClose: { enabled: false },
    });
    expect(next).toEqual({
      ...stored,
      autoArchiveEnabled: false,
      autoCloseEnabled: false,
    });
    expect(changed).toEqual(["autoArchive.enabled", "autoClose.enabled"]);
  });

  it("lists only the keys whose value moved", () => {
    expect(
      mergeAutomationPatch(stored, {
        autoArchive: { enabled: true, months: 6 },
        autoClose: { months: 2, columnId: "col-other" },
      }).changed,
    ).toEqual(["autoClose.months", "autoClose.columnId"]);
    expect(
      mergeAutomationPatch(stored, { autoClose: { columnId: null } }).next
        .autoCloseColumnId,
    ).toBeNull();
  });

  it("starts from the defaults when no row exists", () => {
    const { next, changed } = mergeAutomationPatch(
      DEFAULT_AUTOMATION_SETTINGS,
      { autoArchive: { enabled: true } },
    );
    expect(next).toMatchObject({
      autoArchiveEnabled: true,
      autoArchiveMonths: 3,
    });
    expect(changed).toEqual(["autoArchive.enabled"]);
  });
});

describe("hasAutomationChanges", () => {
  it("needs at least one leaf", () => {
    expect(hasAutomationChanges({})).toBe(false);
    expect(hasAutomationChanges({ autoArchive: {} })).toBe(false);
    expect(hasAutomationChanges({ autoClose: { columnId: null } })).toBe(true);
  });
});

describe("autoCloseState", () => {
  it("is off, active or paused with a reason", () => {
    expect(autoCloseState({ autoCloseEnabled: false }, null)).toEqual({
      state: "off",
      pausedReason: null,
    });
    expect(
      autoCloseState({ autoCloseEnabled: true }, { group: "cancelled" }),
    ).toEqual({ state: "active", pausedReason: null });
    expect(autoCloseState({ autoCloseEnabled: true }, null)).toEqual({
      state: "paused",
      pausedReason: "no_column",
    });
    expect(
      autoCloseState({ autoCloseEnabled: true }, { group: "started" }),
    ).toEqual({ state: "paused", pausedReason: "column_not_cancelled" });
  });
});
