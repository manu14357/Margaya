import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { IntegrationPlugin } from "../../../apps/api/src/plugins/types";

const { handlers, findMany, onTaskCreated } = vi.hoisted(() => ({
  handlers: new Map<string, (data: unknown) => Promise<void>>(),
  findMany: vi.fn(async () => [
    {
      id: "integration-1",
      projectId: "project-1",
      type: "actor-probe",
      config: "{}",
    },
  ]),
  onTaskCreated: vi.fn(async () => {}),
}));

vi.mock("../../../apps/api/src/events", () => ({
  subscribeToEvent: (name: string, handler: (data: unknown) => Promise<void>) =>
    handlers.set(name, handler),
}));

vi.mock("../../../apps/api/src/database", () => ({
  default: { query: { integrationTable: { findMany } } },
}));

vi.mock("../../../apps/api/src/intake/guards", () => ({
  triageTaskIds: vi.fn(async () => []),
}));

const { initializeEventSubscriptions, registerPlugin } = await import(
  "../../../apps/api/src/plugins/registry"
);

const created = {
  taskId: "task-1",
  projectId: "project-1",
  title: "Ship it",
  description: "",
  priority: "medium",
  status: "to-do",
  number: 1,
  // The task's first assignee, which is not who created it.
  userId: "assignee-1",
};

describe("task.created integration events", () => {
  beforeAll(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    registerPlugin({
      type: "actor-probe",
      name: "Actor probe",
      onTaskCreated,
    } as unknown as IntegrationPlugin);
    initializeEventSubscriptions();
  });

  beforeEach(() => {
    onTaskCreated.mockClear();
  });

  it("names the creator as the actor, not the first assignee", async () => {
    await handlers.get("task.created")?.({
      ...created,
      currentUserId: "creator-1",
    });

    expect(onTaskCreated).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "task-1", userId: "creator-1" }),
      expect.objectContaining({ integrationId: "integration-1" }),
    );
  });

  it("names no actor when no Margaya user created the task", async () => {
    await handlers.get("task.created")?.({ ...created, userId: "" });

    expect(onTaskCreated).toHaveBeenCalledWith(
      expect.objectContaining({ userId: null }),
      expect.anything(),
    );
  });
});
