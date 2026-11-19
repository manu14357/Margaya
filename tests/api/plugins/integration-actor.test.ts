import { describe, expect, it } from "vitest";
import {
  integrationActor,
  integrationActorName,
  integrationActorOf,
} from "../../../apps/api/src/plugins/integration-actor";

describe("integration actor", () => {
  it("names the account that sent the event, login or username", () => {
    expect(integrationActor("github", { login: "octocat" })).toEqual({
      source: "github",
      login: "octocat",
    });
    expect(integrationActor("gitea", { username: "gitster" })).toEqual({
      source: "gitea",
      login: "gitster",
    });
    expect(integrationActor("gitea", null)).toEqual({ source: "gitea" });
  });

  it("signs notifications with the account, else the integration", () => {
    expect(integrationActorName({ source: "github", login: "octocat" })).toBe(
      "octocat",
    );
    expect(integrationActorName({ source: "github" })).toBe("GitHub");
    expect(integrationActorName({ source: "gitea" })).toBe("Gitea");
  });

  it("reads only a known marker from a payload", () => {
    expect(integrationActorOf({ source: "gitea", login: " a " })).toEqual({
      source: "gitea",
      login: "a",
    });
    expect(integrationActorOf({ source: "other" })).toBeNull();
    expect(integrationActorOf("github")).toBeNull();
    expect(integrationActorOf(undefined)).toBeNull();
  });
});
