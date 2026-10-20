import { beforeEach, describe, expect, it, vi } from "vitest";
import createTask from "./create-task";

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
}));

vi.mock("@margaya/libs", () => ({
  client: {
    task: {
      ":projectId": {
        $post: mocks.post,
      },
    },
  },
}));

describe("createTask", () => {
  beforeEach(() => {
    mocks.post.mockReset();
    mocks.post.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "task-1" }),
    });
  });

  it.each([undefined, []])(
    // An explicit empty list: the server must not apply the project's
    // default assignee, which the web already prefilled (or cleared).
    "sends an empty assignee list when assigneeIds is %s",
    async (assigneeIds) => {
      await createTask(
        "Unassigned task",
        "",
        "project-1",
        assigneeIds,
        "to-do",
        undefined,
        undefined,
        "no-priority",
      );

      expect(mocks.post).toHaveBeenCalledWith({
        json: {
          title: "Unassigned task",
          description: "",
          assigneeIds: [],
          status: "to-do",
          startDate: undefined,
          dueDate: undefined,
          priority: "no-priority",
          customFields: undefined,
        },
        param: { projectId: "project-1" },
      });
    },
  );

  it("sends every assignee in order", async () => {
    await createTask(
      "Assigned task",
      "",
      "project-1",
      ["user-2", "user-1"],
      "to-do",
      undefined,
      undefined,
      "no-priority",
    );

    expect(mocks.post).toHaveBeenCalledWith(
      expect.objectContaining({
        json: expect.objectContaining({ assigneeIds: ["user-2", "user-1"] }),
      }),
    );
    expect(mocks.post.mock.calls[0]?.[0].json).not.toHaveProperty("userId");
  });

  it("sends the parent so the server links the sub-task in one call", async () => {
    await createTask(
      "Child",
      "",
      "project-1",
      [],
      "to-do",
      undefined,
      undefined,
      "no-priority",
      undefined,
      "parent-1",
    );

    expect(mocks.post.mock.calls[0]?.[0].json).toMatchObject({
      parentId: "parent-1",
    });
  });
});
