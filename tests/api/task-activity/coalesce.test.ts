import { describe, expect, it } from "vitest";
import {
  DESCRIPTION_COALESCE_WINDOW_MS,
  decideDescriptionActivity,
} from "../../../apps/api/src/task-activity/coalesce";

const minute = 60 * 1000;

describe("decideDescriptionActivity", () => {
  const own = {
    id: "act-1",
    type: "description_changed",
    userId: "ada",
    ageMs: 3 * minute,
  };

  it("refreshes the same person's recent description row", () => {
    expect(decideDescriptionActivity(own, "ada")).toEqual({
      action: "update",
      activityId: "act-1",
    });
  });

  it("adds a row for another person", () => {
    expect(decideDescriptionActivity(own, "ben")).toEqual({ action: "insert" });
  });

  it("adds a row when something else happened in between", () => {
    expect(
      decideDescriptionActivity({ ...own, type: "comment" }, "ada"),
    ).toEqual({ action: "insert" });
  });

  it("adds a row after ten minutes", () => {
    expect(
      decideDescriptionActivity(
        { ...own, ageMs: DESCRIPTION_COALESCE_WINDOW_MS },
        "ada",
      ),
    ).toEqual({ action: "insert" });
    expect(
      decideDescriptionActivity({ ...own, ageMs: 10 * minute - 1 }, "ada"),
    ).toEqual({ action: "update", activityId: "act-1" });
  });

  it("adds the first row of a task", () => {
    expect(decideDescriptionActivity(undefined, "ada")).toEqual({
      action: "insert",
    });
    expect(decideDescriptionActivity(null, "ada")).toEqual({
      action: "insert",
    });
  });

  it("never folds into a row nobody is credited for", () => {
    expect(decideDescriptionActivity({ ...own, userId: null }, "ada")).toEqual({
      action: "insert",
    });
  });
});
