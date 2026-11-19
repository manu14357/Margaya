import { describe, expect, it } from "vitest";
import { githubActor } from "../../../../../apps/api/src/plugins/github/utils/actor";

describe("githubActor", () => {
  it("names the GitHub account that sent the event", () => {
    expect(githubActor({ login: "octocat" })).toEqual({
      source: "github",
      login: "octocat",
    });
  });

  it("falls back to the integration alone without a sender", () => {
    expect(githubActor(undefined)).toEqual({ source: "github" });
    expect(githubActor(null)).toEqual({ source: "github" });
    expect(githubActor({ login: "  " })).toEqual({ source: "github" });
  });
});
