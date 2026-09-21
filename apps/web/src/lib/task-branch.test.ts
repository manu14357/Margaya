import { describe, expect, it } from "vitest";
import { DEFAULT_BRANCH_PATTERN, taskBranchName } from "./task-branch";

describe("taskBranchName", () => {
  it("fills the pattern from the project slug, number and title", () => {
    expect(taskBranchName(DEFAULT_BRANCH_PATTERN, "WEB", 12, "Fix login")).toBe(
      "web-12",
    );
    expect(
      taskBranchName("{slug}/{number}-{title}", "WEB", 12, "Fix the Login!"),
    ).toBe("web/12-fix-the-login");
  });

  it("is null until the slug and number are known", () => {
    expect(taskBranchName(DEFAULT_BRANCH_PATTERN, undefined, 12, "x")).toBe(
      null,
    );
    expect(taskBranchName(DEFAULT_BRANCH_PATTERN, "WEB", null, "x")).toBe(null);
  });
});
