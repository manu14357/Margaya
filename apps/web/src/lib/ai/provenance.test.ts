import { afterEach, describe, expect, it } from "vitest";
import {
  aiFeatureKey,
  aiTextKeys,
  clearAiText,
  markAiText,
  pendingAiAssist,
  provenanceOf,
  resetAiTextMarks,
} from "./provenance";

afterEach(resetAiTextMarks);

describe("AI text marks", () => {
  it("holds accepted AI text until the save that carries it succeeds", () => {
    const key = aiTextKeys.taskDescription("t1");
    expect(pendingAiAssist(key)).toBeUndefined();

    markAiText(key, "editor_assist");
    expect(pendingAiAssist(key)).toEqual({ feature: "editor_assist" });
    // A failed save leaves the mark for the retry.
    expect(pendingAiAssist(key)).toEqual({ feature: "editor_assist" });

    clearAiText(key);
    expect(pendingAiAssist(key)).toBeUndefined();
  });

  it("keeps editors apart", () => {
    markAiText(aiTextKeys.taskDescription("t1"), "editor_assist");
    expect(pendingAiAssist(aiTextKeys.taskDescription("t2"))).toBeUndefined();
  });
});

describe("provenanceOf", () => {
  it("accepts the API's record and rejects anything else", () => {
    const record = {
      source: "agent",
      feature: "agent_run",
      model: null,
      agentId: "a1",
      agentName: "Triage bot",
      requestedById: "u1",
      generatedAt: "2026-11-13T10:00:00.000Z",
      editedById: null,
      editedByName: null,
      editedAt: null,
    };
    expect(provenanceOf(record)).toBe(record);
    expect(provenanceOf(null)).toBeNull();
    expect(provenanceOf(undefined)).toBeNull();
    expect(provenanceOf({ source: "human" })).toBeNull();
  });
});

describe("aiFeatureKey", () => {
  it("names known features and ignores the rest", () => {
    expect(aiFeatureKey("spec_draft")).toBe("ai:features.spec_draft");
    expect(aiFeatureKey("build_chat")).toBe("ai:features.talk_to_build");
    expect(aiFeatureKey("connection_test")).toBeNull();
    expect(aiFeatureKey(null)).toBeNull();
  });
});
