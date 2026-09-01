import { describe, expect, it } from "vitest";
import { buildFullTaskUpdateBody } from "./task-helpers.js";

describe("buildFullTaskUpdateBody", () => {
  it("merges patch onto existing task", () => {
    // Arrange
    const original = {
      title: "T",
      description: "D",
      status: "open",
      priority: "low",
      projectId: "p1",
      position: 1,
      userId: "u1",
    };
    const patch = { status: "done" as const };

    // Act
    const body = buildFullTaskUpdateBody(original, patch);

    // Assert
    expect(body.status).toBe("done");
    expect(body.title).toBe("T");
    expect(body.position).toBe(1);
  });
});

describe("buildFullTaskUpdateBody assignees", () => {
  const original = {
    title: "T",
    description: "D",
    status: "open",
    priority: "low",
    projectId: "p1",
    position: 1,
    userId: "u1",
    assigneeIds: ["u1", "u2"],
  };

  it("echoes the first assignee so the API keeps every assignee", () => {
    const body = buildFullTaskUpdateBody(original, { title: "New" });
    expect(body.userId).toBe("u1");
    expect(body).not.toHaveProperty("assigneeIds");
  });

  it("sends assigneeIds instead of userId when the patch has them", () => {
    const body = buildFullTaskUpdateBody(original, {
      assigneeIds: ["u2"],
      userId: "u9",
    });
    expect(body.assigneeIds).toEqual(["u2"]);
    expect(body).not.toHaveProperty("userId");
  });

  it("clears with a null list or a null userId", () => {
    expect(
      buildFullTaskUpdateBody(original, { assigneeIds: null }).assigneeIds,
    ).toEqual([]);
    expect(buildFullTaskUpdateBody(original, { userId: null }).userId).toBe("");
  });
});
