import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ notify: vi.fn() }));

vi.mock("../../../apps/api/src/database", () => ({ default: {} }));
vi.mock("../../../apps/api/src/notification/recipients", () => ({
  notifyTaskEvent: m.notify,
}));
vi.mock(
  "../../../apps/api/src/notification/controllers/create-notification",
  () => ({ default: vi.fn() }),
);

const { publishEvent } = await import("../../../apps/api/src/events");
await import("../../../apps/api/src/notification/subscribers");

const base = {
  taskId: "t1",
  projectId: "p1",
  oldStatus: "to-do",
  newStatus: "in-progress",
  title: "Task",
  type: "status_changed",
};

describe("status-change notifications from integration webhooks", () => {
  beforeEach(() => {
    m.notify.mockReset();
    m.notify.mockResolvedValue([]);
  });

  it("are signed with the sending account instead of Someone", async () => {
    await publishEvent(
      "task.status_changed",
      {
        ...base,
        userId: null,
        integration: { source: "github", login: "octocat" },
      },
      { waitForHandlers: true },
    );
    expect(m.notify).toHaveBeenCalledWith({
      taskId: "t1",
      kind: "statusChanged",
      actorId: null,
      eventData: {
        oldStatus: "to-do",
        newStatus: "in-progress",
        integration: { source: "github", login: "octocat" },
        actorName: "octocat",
      },
    });
  });

  it("fall back to the integration's name without an account", async () => {
    await publishEvent(
      "task.status_changed",
      { ...base, userId: null, integration: { source: "gitea" } },
      { waitForHandlers: true },
    );
    expect(m.notify.mock.calls[0]?.[0].eventData).toMatchObject({
      integration: { source: "gitea" },
      actorName: "Gitea",
    });
  });

  it("leave a person's change to the joined actor", async () => {
    await publishEvent(
      "task.status_changed",
      { ...base, userId: "u1", integration: { source: "github", login: "x" } },
      { waitForHandlers: true },
    );
    expect(m.notify.mock.calls[0]?.[0]).toMatchObject({
      actorId: "u1",
      eventData: { oldStatus: "to-do", newStatus: "in-progress" },
    });
    expect(m.notify.mock.calls[0]?.[0].eventData).not.toHaveProperty(
      "actorName",
    );
  });
});
