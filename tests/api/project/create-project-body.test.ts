import { describe, expect, it } from "vitest";
import { createProjectBody } from "../../../apps/api/src/project/schema";

const base = { name: "Plan", workspaceId: "ws-1", icon: "Layout", slug: "PLN" };

describe("createProjectBody estimate", () => {
  it("accepts an estimate system in the POST /estimate shape", () => {
    const parsed = createProjectBody.safeParse({
      ...base,
      estimate: {
        name: " Story points ",
        type: "points",
        values: ["1", "2", "3"],
      },
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.estimate).toEqual({
      name: "Story points",
      type: "points",
      values: ["1", "2", "3"],
    });
  });

  it("stays optional and rejects an unknown type", () => {
    expect(createProjectBody.safeParse(base).success).toBe(true);
    expect(
      createProjectBody.safeParse({
        ...base,
        estimate: { name: "Size", type: "shirts", values: ["S", "M"] },
      }).success,
    ).toBe(false);
  });
});
