import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { AiProvenance } from "../../apps/api/src/ai/provenance";
import db, { schema } from "../../apps/api/src/database";
import { aiUsageTable } from "../../apps/api/src/database/schema";
import { resetRateLimitMemory } from "../../apps/api/src/utils/rate-limit";
import { resetTestDatabase } from "./helpers/database";
import { draftScene } from "./helpers/drafts";

// AI content labels (EU AI Act Article 50): text accepted from AI is saved
// with aiProvenance, a person's later change names them, and the label shows
// in task, comment and page reads.

type Scene = Awaited<ReturnType<typeof draftScene>>;
type Labelled = { id: string; aiProvenance?: AiProvenance | null };

beforeEach(async () => {
  await resetTestDatabase();
  resetRateLimitMemory();
});

async function createTask(s: Scene, body: Record<string, unknown> = {}) {
  return s.ok<Labelled>(s.mia, "POST", `/task/${s.web.project.id}`, {
    title: "Login fails",
    description: "",
    priority: "low",
    status: "to-do",
    ...body,
  });
}

describe("task descriptions", () => {
  it("labels a description accepted from AI, with the model from the ledger", async () => {
    const s = await draftScene();
    await db.insert(aiUsageTable).values({
      workspaceId: s.workspaceId,
      userId: s.mia.id,
      feature: "editor_assist",
      provider: "fake",
      model: "fake-fast",
      tier: "fast",
      dataTier: "private",
      status: "ok",
    });
    const task = await createTask(s);
    expect(task.aiProvenance ?? null).toBeNull();

    const updated = await s.ok<Labelled>(
      s.mia,
      "PUT",
      `/task/description/${task.id}`,
      {
        description: "Steps to reproduce",
        aiAssist: { feature: "editor_assist" },
      },
    );
    expect(updated.aiProvenance).toMatchObject({
      source: "assist",
      feature: "editor_assist",
      model: "fake-fast",
      requestedById: s.mia.id,
      editedById: null,
    });

    const read = await s.ok<Labelled>(s.mia, "GET", `/task/${task.id}`);
    expect(read.aiProvenance?.feature).toBe("editor_assist");
  });

  it("names the person who edits AI-written text, and ignores unchanged saves", async () => {
    const s = await draftScene();
    const task = await createTask(s, {
      description: "Drafted",
      aiAssist: { feature: "talk_to_build" },
    });
    expect(task.aiProvenance?.feature).toBe("talk_to_build");

    // A full update that echoes the description is no edit.
    const [row] = await db
      .select()
      .from(schema.taskTable)
      .where(eq(schema.taskTable.id, task.id));
    await s.ok(s.ada, "PUT", `/task/${task.id}`, {
      title: "Renamed",
      description: "Drafted",
      priority: "low",
      status: "to-do",
      projectId: s.web.project.id,
      position: row?.position ?? 0,
    });
    let read = await s.ok<Labelled>(s.ada, "GET", `/task/${task.id}`);
    expect(read.aiProvenance?.editedById).toBeNull();

    await s.ok(s.ada, "PUT", `/task/description/${task.id}`, {
      description: "Drafted, then checked",
    });
    read = await s.ok<Labelled>(s.ada, "GET", `/task/${task.id}`);
    expect(read.aiProvenance).toMatchObject({
      feature: "talk_to_build",
      editedById: s.ada.id,
      editedByName: "Ada",
    });
  });

  it("leaves a person's own description unlabelled", async () => {
    const s = await draftScene();
    const task = await createTask(s);
    await s.ok(s.mia, "PUT", `/task/description/${task.id}`, {
      description: "Written by hand",
    });
    const read = await s.ok<Labelled>(s.mia, "GET", `/task/${task.id}`);
    expect(read.aiProvenance).toBeNull();
  });
});

describe("comments", () => {
  it("labels a comment accepted from AI in both comment APIs", async () => {
    const s = await draftScene();
    const task = await createTask(s);
    const created = await s.ok<Labelled>(s.mia, "POST", "/activity/comment", {
      taskId: task.id,
      comment: "Summary of the thread",
      aiAssist: { feature: "summarize" },
    });
    expect(created.aiProvenance?.feature).toBe("summarize");

    const comments = await s.ok<Labelled[]>(
      s.mia,
      "GET",
      `/comment/${task.id}`,
    );
    expect(comments[0]?.aiProvenance?.source).toBe("assist");

    await s.ok(s.mia, "PUT", "/activity/comment", {
      activityId: created.id,
      comment: "Summary of the thread, corrected",
    });
    const feed = await s.ok<(Labelled & { type: string })[]>(
      s.mia,
      "GET",
      `/activity/${task.id}`,
    );
    const comment = feed.find((item) => item.id === created.id);
    expect(comment?.aiProvenance).toMatchObject({
      feature: "summarize",
      editedById: s.mia.id,
    });
  });
});

describe("pages", () => {
  it("labels AI pages at creation and after an accepted AI insert", async () => {
    const s = await draftScene();
    await db
      .update(schema.projectTable)
      .set({ pagesEnabled: true })
      .where(eq(schema.projectTable.id, s.web.project.id));

    const brief = await s.ok<Labelled>(
      s.mia,
      "POST",
      `/page/project/${s.web.project.id}`,
      { title: "Brief", content: "# Status", aiAssist: { feature: "brief" } },
    );
    expect(brief.aiProvenance?.feature).toBe("brief");

    const notes = await s.ok<Labelled>(
      s.mia,
      "POST",
      `/page/project/${s.web.project.id}`,
      { title: "Notes", content: "Hand written" },
    );
    expect(notes.aiProvenance).toBeNull();

    const marked = await s.ok<{ aiProvenance: AiProvenance }>(
      s.mia,
      "POST",
      `/page/${notes.id}/ai-provenance`,
      { feature: "editor_assist" },
    );
    expect(marked.aiProvenance.feature).toBe("editor_assist");

    // A viewer may not label pages.
    const denied = await s.as(s.vic)(
      "POST",
      `/page/${notes.id}/ai-provenance`,
      { feature: "editor_assist" },
    );
    expect(denied.status).toBe(403);
  });
});
