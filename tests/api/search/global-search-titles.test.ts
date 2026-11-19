import { beforeEach, describe, expect, it, vi } from "vitest";

const sources = vi.hoisted(() => ({
  comments: [] as unknown[],
  activities: [] as unknown[],
}));

vi.mock("../../../apps/api/src/database", () => {
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => Promise.resolve([{ workspaceId: "w1" }]),
  };
  return { default: chain };
});

vi.mock("../../../apps/api/src/project/visibility", () => ({
  hiddenForCurrentRequest: async () => [],
  notHiddenProject: () => undefined,
}));

vi.mock("../../../apps/api/src/page/search-pages", () => ({
  searchPages: async () => [],
}));

vi.mock("../../../apps/api/src/search/sources", () => ({
  computedScore: () => ({ match: undefined, score: undefined }),
  findTaskByKey: async () => [],
  findTasks: async () => [],
  findComments: async () => sources.comments,
  findActivities: async () => sources.activities,
}));

const { default: globalSearch } = await import(
  "../../../apps/api/src/search/controllers/global-search"
);

function hit(overrides: Record<string, unknown>) {
  return {
    id: "a1",
    type: "comment",
    content: null,
    eventData: {},
    taskId: "t1",
    taskTitle: "Fix the login page",
    taskNumber: 12,
    projectId: "p1",
    projectName: "Web",
    projectSlug: "web",
    workspaceId: "w1",
    workspaceName: "Acme",
    userId: "u1",
    userName: "Ada",
    createdAt: new Date("2026-11-20T10:00:00Z"),
    score: 2,
    ...overrides,
  };
}

describe("global search titles of comments and activities", () => {
  beforeEach(() => {
    sources.comments = [];
    sources.activities = [];
  });

  it("titles a comment with its task, not English copy", async () => {
    sources.comments = [hit({ content: "Looks good" })];
    const { results } = await globalSearch({
      query: "looks",
      userId: "u1",
      type: "comments",
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      type: "comment",
      title: "Fix the login page",
      taskId: "t1",
    });
  });

  it("titles an activity with its task, never the raw event key", async () => {
    sources.activities = [
      hit({ id: "a2", type: "parent_changed", eventData: {} }),
      hit({ id: "a3", type: "relation_added", eventData: {} }),
      hit({ id: "a4", type: "task", eventData: {} }),
    ];
    const { results } = await globalSearch({
      query: "login",
      userId: "u1",
      type: "activities",
    });
    expect(results.map((result) => result.title)).toEqual([
      "Fix the login page",
      "Fix the login page",
      "Fix the login page",
    ]);
    for (const result of results) {
      expect(result.title).not.toMatch(/parent_changed|relation_added| on /);
    }
  });

  it("falls back to the task key when the task has no title", async () => {
    sources.activities = [hit({ type: "label_added", taskTitle: null })];
    const { results } = await globalSearch({
      query: "web",
      userId: "u1",
      type: "activities",
    });
    expect(results[0]?.title).toBe("WEB-12");
  });
});
