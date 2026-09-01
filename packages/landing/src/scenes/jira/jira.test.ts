import { describe, expect, it } from "vitest";
import messages from "../../../../../i18n/en-US.json";
import { finalStateOf } from "../../demo";
import { createJiraScene } from "./jira-scene";
import { initialJiraState, jiraReducer } from "./state";

describe("jira import scene", () => {
  it("ends imported, with Code Review mapped to In review", () => {
    const final = finalStateOf(createJiraScene());
    expect(final.step).toBe("done");
    expect(final.file).toBe(true);
    expect(final.mapping.review).toBe("inReview");
    expect(final.picking).toBeNull();
    expect(messages.landing.demo.jira.result).toBe("42 tasks imported");
  });

  it("needs a file before the mapping step", () => {
    expect(jiraReducer(initialJiraState, { type: "next" })).toBe(
      initialJiraState,
    );
  });

  it("only finishes an import that is running", () => {
    expect(jiraReducer(initialJiraState, { type: "finish" })).toBe(
      initialJiraState,
    );
  });

  it("starts over on reset", () => {
    const final = finalStateOf(createJiraScene());
    expect(jiraReducer(final, { type: "reset" })).toEqual(initialJiraState);
  });
});
