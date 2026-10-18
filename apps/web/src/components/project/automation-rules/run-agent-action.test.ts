import { describe, expect, it } from "vitest";
import {
  ACTION_TYPES,
  draftComplete,
  draftToInput,
  emptyAction,
  emptyDraft,
} from "./rule-model";

describe("the Run agent action", () => {
  it("is offered and starts empty", () => {
    expect(ACTION_TYPES).toContain("run_agent");
    expect(emptyAction("run_agent")).toEqual({
      type: "run_agent",
      agentId: "",
      prompt: "",
    });
  });

  it("needs an agent and a prompt", () => {
    const draft = { ...emptyDraft(), name: "Triage bugs" };
    expect(
      draftComplete({ ...draft, actions: [emptyAction("run_agent")] }),
    ).toBe(false);
    expect(
      draftComplete({
        ...draft,
        actions: [{ type: "run_agent", agentId: "agent-1", prompt: "  " }],
      }),
    ).toBe(false);
    const complete = {
      ...draft,
      actions: [
        {
          type: "run_agent" as const,
          agentId: "agent-1",
          prompt: "Triage {{task.key}}",
        },
      ],
    };
    expect(draftComplete(complete)).toBe(true);
    expect(draftToInput(complete).actions).toEqual(complete.actions);
  });
});
