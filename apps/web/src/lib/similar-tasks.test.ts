import { describe, expect, it } from "vitest";
import { similarTasksQuery } from "./similar-tasks";

describe("similarTasksQuery", () => {
  it("waits for three words", () => {
    expect(similarTasksQuery("Login page")).toBeNull();
    expect(similarTasksQuery("  Login   page   broken ")).toBe(
      "login page broken",
    );
  });
});
