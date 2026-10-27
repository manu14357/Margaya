import type { User } from "better-auth/types";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { projectMemberTable } from "../../apps/api/src/database/schema";
import { createApp } from "../../apps/api/src/index";
import { backfillSearchIndex } from "../../apps/api/src/search/backfill";
import { searchWorkspace } from "../../apps/api/src/search/search-workspace";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

// A1: PostgreSQL full-text search behind /api/search and searchWorkspace().

type Snippet = { text: string; highlights: { start: number; end: number }[] };
type Result = {
  id: string;
  type: string;
  title: string;
  relevanceScore: number;
  taskId?: string;
  snippet?: Snippet;
};

function marked(snippet: Snippet | undefined) {
  return (snippet?.highlights ?? []).map(({ start, end }) =>
    snippet?.text.slice(start, end),
  );
}

async function scene() {
  const { user: owner, workspace } = await createWorkspaceMember({
    role: "owner",
  });
  const member = await addWorkspaceMember(workspace.id, "member");
  const { project } = await createProjectFixture({
    workspaceId: workspace.id,
    name: "Website",
    slug: "WEB",
  });
  let number = 0;
  async function task(
    title: string,
    description: string | null = null,
    projectId = project.id,
  ) {
    number += 1;
    const [row] = await db
      .insert(schema.taskTable)
      .values({ projectId, title, description, number })
      .returning();
    if (!row) throw new Error("task not created");
    return row;
  }
  async function comment(taskId: string, content: string) {
    const [row] = await db
      .insert(schema.activityTable)
      .values({ taskId, type: "comment", content, userId: owner.id })
      .returning();
    if (!row) throw new Error("comment not created");
    return row;
  }
  async function search(user: User, q: string, type = "all") {
    mockAuthenticatedSession(user);
    const { app } = createApp();
    const response = await app.request(
      `/api/search?${new URLSearchParams({ q, workspaceId: workspace.id, type })}`,
    );
    expect(response.status).toBe(200);
    return ((await response.json()) as { results: Result[] }).results;
  }
  return { owner, member, workspace, project, task, comment, search };
}

describe("API integration: full-text search", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("ranks title matches above description matches, with highlighted snippets", async () => {
    const s = await scene();
    const inDescription = await s.task(
      "Quarterly planning",
      "We still need a date for the rocket launch and a backup plan.",
    );
    const inTitle = await s.task("Rocket launch checklist");
    await s.task("Unrelated chores", "Nothing to see here.");

    const results = await s.search(s.member, "rocket launch", "tasks");
    expect(results.map((r) => r.id)).toEqual([inTitle.id, inDescription.id]);
    expect(results[0]?.relevanceScore).toBeGreaterThan(3);
    expect(results[1]?.relevanceScore).toBeGreaterThan(2);
    expect(results[1]?.relevanceScore).toBeLessThan(3);
    expect(marked(results[1]?.snippet)).toEqual(["rocket", "launch"]);
  });

  it("puts an exact task key first, in any case", async () => {
    const s = await scene();
    for (let i = 0; i < 11; i++) await s.task(`Filler ${i}`);
    const keyed = await s.task("Footer links");
    // Mentions the key in text only: ranks below the key match.
    const mention = await s.task(
      "Follow-up",
      "Blocked by WEB-12 until next week.",
    );
    for (const q of ["WEB-12", "web-12"]) {
      const results = await s.search(s.member, q, "tasks");
      expect(results[0]).toMatchObject({ id: keyed.id, relevanceScore: 10 });
      expect(results.map((r) => r.id)).toContain(mention.id);
    }
  });

  it("matches the last word as a prefix while typing, and honours exclusions", async () => {
    const s = await scene();
    const rocket = await s.task("Rocket launch plan");
    const rocketBug = await s.task("Rocket telemetry bug");

    expect(
      (await s.search(s.member, "rock", "tasks")).map((r) => r.id),
    ).toEqual(expect.arrayContaining([rocket.id, rocketBug.id]));
    expect(
      (await s.search(s.member, "launch pl", "tasks")).map((r) => r.id),
    ).toEqual([rocket.id]);
    expect(
      (await s.search(s.member, "rocket -bug", "tasks")).map((r) => r.id),
    ).toEqual([rocket.id]);
    expect(
      (await s.search(s.member, '"telemetry bug"', "tasks")).map((r) => r.id),
    ).toEqual([rocketBug.id]);
  });

  it("keeps `or` an OR when the last word is matched as a prefix", async () => {
    const s = await scene();
    const launch = await s.task("Launch checklist");
    const telemetry = await s.task("Telemetry dashboard");
    await s.task("Unrelated chore");

    const sorted = (ids: string[]) => [...ids].sort();
    for (const q of ["launch or telemetry", "launch OR tele"]) {
      expect(
        sorted((await s.search(s.member, q, "tasks")).map((r) => r.id)),
      ).toEqual(sorted([launch.id, telemetry.id]));
    }
    // `or` binds looser than the implicit AND: (launch & dashboard) | tele*.
    expect(
      (await s.search(s.member, "launch dashboard or tele", "tasks")).map(
        (r) => r.id,
      ),
    ).toEqual([telemetry.id]);
  });

  it("searches comments by their own text and links them to their task", async () => {
    const s = await scene();
    const parent = await s.task("Zoo visit");
    const note = await s.comment(parent.id, "Bring snacks for the giraffes");
    await s.comment(parent.id, "Tickets are booked");

    const results = await s.search(s.member, "giraffe", "comments");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: note.id,
      type: "comment",
      taskId: parent.id,
    });
    expect(marked(results[0]?.snippet)).toEqual(["giraffes"]);
  });

  it("re-indexes a task when its text or project key changes", async () => {
    const s = await scene();
    const row = await s.task("Old name");
    await db
      .update(schema.taskTable)
      .set({ description: "Mentions a pelican now" })
      .where(eq(schema.taskTable.id, row.id));
    expect(
      (await s.search(s.member, "pelican", "tasks")).map((r) => r.id),
    ).toEqual([row.id]);

    await db
      .update(schema.projectTable)
      .set({ slug: "SITE" })
      .where(eq(schema.projectTable.id, s.project.id));
    const [{ tsv } = { tsv: "" }] = (
      await db.execute<{ tsv: string }>(
        sql`select search_tsv::text as tsv from task where id = ${row.id}`,
      )
    ).rows;
    expect(tsv).toContain("'site'");
    expect(tsv).not.toContain("'web'");
  });

  it("never returns tasks, comments or pages of a restricted project to non-members", async () => {
    const s = await scene();
    const { project: secret } = await createProjectFixture({
      workspaceId: s.workspace.id,
      name: "Secret",
      slug: "SEC",
    });
    await db
      .update(schema.projectTable)
      .set({ visibility: "restricted" })
      .where(eq(schema.projectTable.id, secret.id));
    const insider = await addWorkspaceMember(s.workspace.id, "member");
    await db
      .insert(projectMemberTable)
      .values({ projectId: secret.id, userId: insider.id });

    const hiddenTask = await s.task("Zebracorn plans", null, secret.id);
    await s.comment(hiddenTask.id, "Zebracorn comment");
    await db.insert(schema.pageTable).values({
      workspaceId: s.workspace.id,
      projectId: secret.id,
      title: "Zebracorn page",
      access: "public",
      ownerId: s.owner.id,
    });
    const visible = await s.task("Zebracorn open");

    const outsider = await s.search(s.member, "zebracorn");
    expect(outsider.map((r) => r.id)).toEqual([visible.id]);
    const byKey = await s.search(s.member, `SEC-${hiddenTask.number}`);
    expect(byKey.map((r) => r.id)).not.toContain(hiddenTask.id);
    expect(
      await searchWorkspace({
        userId: s.member.id,
        workspaceId: s.workspace.id,
        query: "zebracorn",
      }),
    ).toEqual([expect.objectContaining({ id: visible.id })]);

    const insiderTypes = (await s.search(insider, "zebracorn")).map(
      (r) => r.type,
    );
    expect(insiderTypes.sort()).toEqual(["comment", "page", "task", "task"]);
  });

  it("handles Cyrillic and Japanese text", async () => {
    const s = await scene();
    const russian = await s.task("Привет мир", "Отчёт за квартал");
    const japanese = await s.task("東京タワーに行きました", "日本語 テスト");

    expect(
      (await s.search(s.member, "ПРИВЕТ", "tasks")).map((r) => r.id),
    ).toEqual([russian.id]);
    expect(
      (await s.search(s.member, "прив", "tasks")).map((r) => r.id),
    ).toEqual([russian.id]);
    expect(
      (await s.search(s.member, "отчёт", "tasks")).map((r) => r.id),
    ).toEqual([russian.id]);
    // Prefix of the run, a word inside it (substring), and a spaced word.
    for (const q of ["東京", "タワー", "テスト"]) {
      expect((await s.search(s.member, q, "tasks")).map((r) => r.id)).toEqual([
        japanese.id,
      ]);
    }
  });

  it("ignores accents when unaccent is installed", async () => {
    const s = await scene();
    const cafe = await s.task("Café crème menu");
    const { rows } = await db.execute(
      sql`select 1 from pg_extension where extname = 'unaccent'`,
    );
    const results = (await s.search(s.member, "cafe creme", "tasks")).map(
      (r) => r.id,
    );
    expect(results).toEqual(rows.length > 0 ? [cafe.id] : []);
    expect(
      (await s.search(s.member, "café", "tasks")).map((r) => r.id),
    ).toEqual([cafe.id]);
  });

  it("finds rows written before the index existed, and the backfill indexes them", async () => {
    const s = await scene();
    const old = await s.task("Legacy pelican task", "Written long ago");
    const oldComment = await s.comment(old.id, "Legacy walrus comment");
    const [page] = await db
      .insert(schema.pageTable)
      .values({
        workspaceId: s.workspace.id,
        projectId: s.project.id,
        title: "Legacy otter page",
        contentText: "Archive of the otter notes",
        access: "public",
        ownerId: s.owner.id,
      })
      .returning();
    await db.insert(schema.activityTable).values({
      taskId: old.id,
      type: "status_changed",
      eventData: { oldStatus: "to-do", newStatus: "done" },
    });
    // What an install upgraded from before the full-text migration holds.
    await db.execute(sql`update task set search_tsv = null`);
    await db.execute(sql`update page set search_tsv = null`);
    await db.execute(sql`update activity set search_tsv = null`);

    expect(
      (await s.search(s.member, "pelican", "tasks")).map((r) => r.id),
    ).toEqual([old.id]);
    expect(
      (await s.search(s.member, "walrus", "comments")).map((r) => r.id),
    ).toEqual([oldComment.id]);
    expect(
      (await s.search(s.owner, "otter", "pages")).map((r) => r.id),
    ).toEqual([page?.id]);

    expect(await backfillSearchIndex()).toEqual({
      task: 1,
      page: 1,
      comment: 1,
    });
    const pending = await db.execute<{ kind: string; count: number }>(sql`
      select 'task' as kind, count(*)::int as count from task where search_tsv is null
      union all select 'page', count(*)::int from page where search_tsv is null
      union all select 'comment', count(*)::int from activity
        where type = 'comment' and search_tsv is null
      union all select 'history', count(*)::int from activity
        where type <> 'comment' and search_tsv is not null`);
    expect(pending.rows.every((row) => row.count === 0)).toBe(true);
    expect(await backfillSearchIndex()).toEqual({
      task: 0,
      page: 0,
      comment: 0,
    });
    expect(
      (await s.search(s.member, "pelican", "tasks")).map((r) => r.id),
    ).toEqual([old.id]);
  });

  it("searchWorkspace filters by type and caps the limit", async () => {
    const s = await scene();
    const first = await s.task("Heron migration notes");
    await s.comment(first.id, "Heron spotted");
    await db.insert(schema.pageTable).values({
      workspaceId: s.workspace.id,
      projectId: s.project.id,
      title: "Heron handbook",
      access: "public",
      ownerId: s.owner.id,
    });

    const hits = await searchWorkspace({
      userId: s.member.id,
      workspaceId: s.workspace.id,
      query: "heron",
      types: ["task", "comment"],
    });
    expect(hits.map((hit) => hit.type).sort()).toEqual(["comment", "task"]);
    expect(hits.find((hit) => hit.type === "comment")).toMatchObject({
      taskId: first.id,
      projectSlug: "WEB",
    });

    const one = await searchWorkspace({
      userId: s.member.id,
      workspaceId: s.workspace.id,
      query: "heron",
      limit: 1,
    });
    expect(one).toHaveLength(1);

    const stranger = await createWorkspaceMember();
    expect(
      await searchWorkspace({
        userId: stranger.user.id,
        workspaceId: s.workspace.id,
        query: "heron",
      }),
    ).toEqual([]);
  });
});
