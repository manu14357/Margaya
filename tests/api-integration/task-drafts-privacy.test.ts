import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import { draftScene } from "./helpers/drafts";

// Drafts live in their own table (K1), so no task reader can see them. MCP
// tools read through these same HTTP routes, so this covers them too.

beforeEach(async () => {
  await resetTestDatabase();
});

const SECRET = "Zebra-secret-draft";

describe("drafts never reach task readers", () => {
  it("stays out of boards, queries, search, exports, labels and analytics", async () => {
    const s = await draftScene();
    const projectId = s.web.project.id;
    await db.insert(schema.taskTable).values({
      projectId,
      title: "A real task",
      number: 1,
      status: "to-do",
      columnId: s.web.columns.todo.id,
    });

    const reads = {
      board: () => s.as(s.owner)("GET", `/task/tasks/${projectId}`),
      query: () =>
        s.as(s.owner)("POST", "/task-query", {
          workspaceId: s.workspaceId,
          archived: "include",
        }),
      search: () =>
        s.as(s.owner)(
          "GET",
          `/search?${new URLSearchParams({ q: "Zebra", workspaceId: s.workspaceId })}`,
        ),
      export: () => s.as(s.owner)("GET", `/task/export/${projectId}`),
      labels: () => s.as(s.owner)("GET", `/label/workspace/${s.workspaceId}`),
      projects: () =>
        s.as(s.owner)("GET", `/project?workspaceId=${s.workspaceId}`),
      analytics: () =>
        s.as(s.owner)(
          "GET",
          `/analytics/overview?workspaceId=${s.workspaceId}`,
        ),
    };
    const snapshot = async () => {
      const out: Record<string, string> = {};
      for (const [name, read] of Object.entries(reads)) {
        const response = await read();
        const body = await response.text();
        expect(response.status, `${name}: ${body}`).toBe(200);
        out[name] = body;
      }
      return out;
    };
    const before = await snapshot();

    for (const user of [s.owner, s.mia]) {
      await s.createDraft(user, {
        projectId,
        title: SECRET,
        description: `${SECRET} body`,
        status: "to-do",
        assigneeIds: [s.ada.id],
        labels: [{ name: "zebra-label", color: "red" }],
        dueDate: "2026-01-01",
      });
    }
    const after = await snapshot();

    for (const [name, body] of Object.entries(after)) {
      expect(body, name).not.toContain(SECRET);
      expect(body, name).not.toContain("zebra-label");
    }
    const analyticsBefore = JSON.parse(before.analytics ?? "{}");
    const analyticsAfter = JSON.parse(after.analytics ?? "{}");
    expect(analyticsAfter.tasks).toEqual(analyticsBefore.tasks);
    expect(JSON.parse(after.projects ?? "[]")).toEqual(
      JSON.parse(before.projects ?? "[]"),
    );
  });
});
