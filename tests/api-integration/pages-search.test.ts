import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { type PageScene, pageScene } from "./helpers/pages";

type SearchJson = {
  results: Array<{
    id: string;
    type: string;
    title: string;
    content?: string;
    projectId?: string;
    relevanceScore: number;
  }>;
};

async function search(
  s: PageScene,
  user: PageScene["ben"],
  q: string,
  type = "all",
) {
  mockAuthenticatedSession(user);
  const response = await s.app.request(
    `/api/search?workspaceId=${s.workspaceId}&q=${encodeURIComponent(q)}&type=${type}`,
  );
  expect(response.status).toBe(200);
  return ((await response.json()) as SearchJson).results;
}

describe("API integration: page search", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("ranks title matches above content matches, with a snippet", async () => {
    const s = await pageScene();
    const inContent = await s.create(s.ben, {
      title: "Notes",
      content: `${"Intro words here. ".repeat(20)}The roadmap starts in spring. ${"More words follow. ".repeat(20)}`,
    });
    const inTitle = await s.create(s.ben, { title: "Roadmap" });

    const results = await search(s, s.cara, "roadmap", "pages");
    expect(results.map((r) => r.id)).toEqual([inTitle.id, inContent.id]);
    expect(results.every((r) => r.type === "page")).toBe(true);
    const snippet = results[1]?.content ?? "";
    expect(snippet).toContain("roadmap starts");
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    expect(Array.from(snippet).length).toBeLessThanOrEqual(162);
  });

  it("shows private pages to their owner only and hides archived and disabled ones", async () => {
    const s = await pageScene();
    const secret = await s.create(s.ben, {
      title: "Zebra secret",
      access: "private",
    });
    const archived = await s.create(s.ben, { title: "Zebra archived" });
    await s.ok(s.ben, `/${archived.id}/archive`, { method: "POST" });
    const other = await s.project2();
    await s.create(s.ben, { title: "Zebra elsewhere" }, other.id);
    await db
      .update(schema.projectTable)
      .set({ pagesEnabled: false })
      .where(eq(schema.projectTable.id, other.id));

    expect((await search(s, s.ben, "zebra")).map((r) => r.id)).toEqual([
      secret.id,
    ]);
    expect(await search(s, s.cara, "zebra")).toEqual([]);
    expect(await search(s, s.admin, "zebra")).toEqual([]);
  });

  it("returns only pages for type=pages and escapes LIKE wildcards", async () => {
    const s = await pageScene();
    await s.create(s.ben, { title: "100% done" });
    await s.create(s.ben, { title: "1000 done" });
    await db.insert(schema.taskTable).values({
      projectId: s.project.id,
      title: "100% done task",
      number: 1,
    });

    const pages = await search(s, s.ben, "100%", "pages");
    expect(pages.map((r) => r.title)).toEqual(["100% done"]);
    const underscore = await search(s, s.ben, "1_0", "pages");
    expect(underscore).toEqual([]);

    const all = await search(s, s.ben, "100%");
    expect(all.map((r) => r.type).sort()).toEqual(["page", "task"]);
  });
});
