import { beforeEach, describe, expect, it } from "vitest";
import { resetTestDatabase } from "./helpers/database";
import { draftScene } from "./helpers/drafts";
import {
  clearPublishedEvents,
  publishedEvents,
  recordEvents,
} from "./helpers/intake";

recordEvents("project.archived", "project.unarchived");

beforeEach(async () => {
  await resetTestDatabase();
  clearPublishedEvents();
});

type ProjectJson = { id: string; archivedAt: string | null };

describe("project archive events", () => {
  it("publishes once per state change and keeps the first archive time", async () => {
    const s = await draftScene();
    const id = s.web.project.id;

    const archived = await s.ok<ProjectJson>(
      s.ada,
      "PUT",
      `/project/${id}/archive`,
    );
    expect(archived.archivedAt).not.toBeNull();
    const again = await s.ok<ProjectJson>(
      s.ada,
      "PUT",
      `/project/${id}/archive`,
    );
    expect(again.archivedAt).toBe(archived.archivedAt);
    expect(publishedEvents().map((e) => [e.name, e.data])).toEqual([
      [
        "project.archived",
        expect.objectContaining({
          projectId: id,
          workspaceId: s.workspaceId,
          userId: s.ada.id,
        }),
      ],
    ]);

    clearPublishedEvents();
    const restored = await s.ok<ProjectJson>(
      s.ada,
      "PUT",
      `/project/${id}/unarchive`,
    );
    expect(restored.archivedAt).toBeNull();
    await s.ok(s.ada, "PUT", `/project/${id}/unarchive`);
    expect(publishedEvents().map((e) => e.name)).toEqual([
      "project.unarchived",
    ]);
  });

  it("needs project:update", async () => {
    const s = await draftScene();
    const response = await s.as(s.mia)(
      "PUT",
      `/project/${s.web.project.id}/archive`,
    );
    expect(response.status).toBe(403);
    expect(publishedEvents()).toEqual([]);
  });
});
