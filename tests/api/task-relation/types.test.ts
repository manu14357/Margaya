import { describe, expect, it } from "vitest";
import {
  isDirectionalRelationType,
  normalizeRelationInput,
  RELATION_INPUT_NAMES,
  relationPerspective,
} from "../../../apps/api/src/task-relation/types";

describe("normalizeRelationInput", () => {
  it.each([
    ["subtask", "subtask", false],
    ["blocks", "blocks", false],
    ["blocking", "blocks", false],
    ["blocked_by", "blocks", true],
    ["related", "related", false],
    ["duplicate", "duplicate", false],
    ["start_before", "start_before", false],
    ["start_after", "start_before", true],
    ["finish_before", "finish_before", false],
    ["finish_after", "finish_before", true],
  ] as const)("%s is stored as %s (flipped: %s)", (input, stored, flipped) => {
    expect(
      normalizeRelationInput({
        sourceTaskId: "x",
        targetTaskId: "y",
        relationType: input,
      }),
    ).toEqual({
      sourceTaskId: flipped ? "y" : "x",
      targetTaskId: flipped ? "x" : "y",
      relationType: stored,
    });
  });

  it("covers exactly the ten input names", () => {
    expect([...RELATION_INPUT_NAMES].sort()).toEqual(
      [
        "blocked_by",
        "blocking",
        "blocks",
        "duplicate",
        "finish_after",
        "finish_before",
        "related",
        "start_after",
        "start_before",
        "subtask",
      ].sort(),
    );
  });
});

describe("relationPerspective", () => {
  it.each([
    ["blocks", "blocking", "blocked_by"],
    ["start_before", "start_before", "start_after"],
    ["finish_before", "finish_before", "finish_after"],
    ["related", "related", "related"],
    ["duplicate", "duplicate", "duplicate"],
    ["subtask", "subtask", "subtask"],
  ])(
    "%s reads %s from the source and %s from the target",
    (stored, fromSource, fromTarget) => {
      expect(relationPerspective(stored, true)).toBe(fromSource);
      expect(relationPerspective(stored, false)).toBe(fromTarget);
    },
  );

  it("reads an input name back from the side that sent it", () => {
    for (const input of RELATION_INPUT_NAMES) {
      const stored = normalizeRelationInput({
        sourceTaskId: "me",
        targetTaskId: "other",
        relationType: input,
      });
      const mine = relationPerspective(
        stored.relationType,
        stored.sourceTaskId === "me",
      );
      const expected = input === "blocks" ? "blocking" : input;
      expect(mine).toBe(expected);
    }
  });
});

describe("isDirectionalRelationType", () => {
  it("checks loops only for ordering types", () => {
    expect(isDirectionalRelationType("blocks")).toBe(true);
    expect(isDirectionalRelationType("start_before")).toBe(true);
    expect(isDirectionalRelationType("finish_before")).toBe(true);
    expect(isDirectionalRelationType("related")).toBe(false);
    expect(isDirectionalRelationType("duplicate")).toBe(false);
    expect(isDirectionalRelationType("subtask")).toBe(false);
  });
});
