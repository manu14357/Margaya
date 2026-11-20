import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ publish: vi.fn() }));

vi.mock("../../../../../apps/api/src/database", () => {
  const returning = async () => [{ id: "link-1", taskId: "task-1" }];
  const db = {
    query: {
      taskTable: { findFirst: async () => ({ projectId: "project-1" }) },
    },
    insert: () => ({ values: () => ({ returning }) }),
    update: () => ({ set: () => ({ where: () => ({ returning }) }) }),
    delete: () => ({ where: () => ({ returning }) }),
  };
  return { default: db };
});
vi.mock("../../../../../apps/api/src/events", () => ({
  publishEvent: m.publish,
}));

const { createExternalLink, deleteExternalLink, updateExternalLink } =
  await import(
    "../../../../../apps/api/src/plugins/github/services/link-manager"
  );

const hint = [
  "task.external_link_changed",
  { taskId: "task-1", projectId: "project-1" },
];

describe("integration resources reach open task panels", () => {
  beforeEach(() => vi.clearAllMocks());

  it("announces a pull request linked by a webhook", async () => {
    await createExternalLink({
      taskId: "task-1",
      integrationId: "integration-1",
      resourceType: "pull_request",
      externalId: "7",
      url: "https://example.com/pull/7",
    });
    expect(m.publish).toHaveBeenCalledWith(...hint);
  });

  it("announces an updated and a removed resource", async () => {
    await updateExternalLink("link-1", { metadata: { state: "closed" } });
    await deleteExternalLink("link-1");
    expect(m.publish).toHaveBeenCalledTimes(2);
    expect(m.publish).toHaveBeenNthCalledWith(1, ...hint);
    expect(m.publish).toHaveBeenNthCalledWith(2, ...hint);
  });

  it("stays quiet inside a caller's transaction", async () => {
    const tx = {
      insert: () => ({
        values: () => ({ returning: async () => [{ id: "link-2" }] }),
      }),
    };
    await createExternalLink(
      {
        taskId: "task-1",
        integrationId: "integration-1",
        resourceType: "issue",
        externalId: "1",
        url: "https://example.com/issues/1",
      },
      tx as never,
    );
    expect(m.publish).not.toHaveBeenCalled();
  });
});
