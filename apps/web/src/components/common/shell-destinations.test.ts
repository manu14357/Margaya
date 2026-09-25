import { describe, expect, it } from "vitest";
import {
  destinationPath,
  projectIdFromPath,
  resolveDestination,
} from "./shell-destinations";

const ws = "/dashboard/workspace/w1";

describe("resolveDestination", () => {
  it.each([
    [ws, "home"],
    [`${ws}/`, "home"],
    [`${ws}/stickies`, "home"],
    ["/dashboard/invitations", "home"],
    [`${ws}/inbox`, "inbox"],
    [`${ws}/my-work`, "my-work"],
    [`${ws}/drafts`, "my-work"],
    [`${ws}/projects`, "projects"],
    [`${ws}/views/all`, "projects"],
    [`${ws}/archives`, "projects"],
    [`${ws}/search`, "projects"],
    [`${ws}/project/p1/board`, "projects"],
    [`${ws}/project/p1/cycles/c1`, "projects"],
    [`${ws}/project/p1/pages`, "pages"],
    [`${ws}/project/p1/pages/pg1`, "pages"],
    [`${ws}/analytics`, "analytics"],
    [`${ws}/project/p1/analytics`, "projects"],
    [`${ws}/members`, "settings"],
    ["/dashboard/settings/account/information", "settings"],
    ["/dashboard/workspace/create", "home"],
  ])("%s belongs to %s", (pathname, destination) => {
    expect(resolveDestination(pathname)).toBe(destination);
  });
});

describe("destinationPath", () => {
  it("lands each destination on its page", () => {
    expect(destinationPath("home", "w1")).toBe(ws);
    expect(destinationPath("inbox", "w1")).toBe(`${ws}/inbox`);
    expect(destinationPath("my-work", "w1")).toBe(`${ws}/my-work`);
    expect(destinationPath("projects", "w1")).toBe(`${ws}/projects`);
    expect(destinationPath("analytics", "w1")).toBe(`${ws}/analytics`);
    expect(destinationPath("settings", "w1")).toBe(
      "/dashboard/settings/account/information",
    );
  });
});

describe("projectIdFromPath", () => {
  it("reads the project segment", () => {
    expect(projectIdFromPath(`${ws}/project/p9/board`)).toBe("p9");
    expect(projectIdFromPath(`${ws}/inbox`)).toBeUndefined();
  });
});
