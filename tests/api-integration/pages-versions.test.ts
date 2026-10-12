import { asc, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import {
  clearPageEvents,
  json,
  type PageVersionJson,
  pageEvents,
  pageScene,
  recordPageEvents,
} from "./helpers/pages";

async function versionRows(pageId: string) {
  return db
    .select()
    .from(schema.pageVersionTable)
    .where(eq(schema.pageVersionTable.pageId, pageId))
    .orderBy(asc(schema.pageVersionTable.lastSavedAt));
}

async function ageVersions(pageId: string, minutes: number) {
  await db
    .update(schema.pageVersionTable)
    .set({
      lastSavedAt: sql`${schema.pageVersionTable.lastSavedAt} - make_interval(mins => ${minutes})`,
    })
    .where(eq(schema.pageVersionTable.pageId, pageId));
}

describe("API integration: page versions", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    recordPageEvents("page.version_restored", "page.content_updated");
    clearPageEvents();
  });

  it("creates, coalesces and splits versions by user and time", async () => {
    const s = await pageScene();
    const page = await s.create(s.ben, { title: "Doc" });
    expect(await versionRows(page.id)).toHaveLength(0);
    const put = (user: typeof s.ben, markdown: string) =>
      s.ok(user, `/${page.id}/content`, json("PUT", { markdown }));

    await put(s.ben, "one");
    const [first] = await versionRows(page.id);
    expect(first).toMatchObject({
      ownerId: s.ben.id,
      contributorIds: [s.ben.id],
      contentMarkdown: "one",
      title: "Doc",
    });

    await put(s.ben, "two");
    const coalesced = await versionRows(page.id);
    expect(coalesced).toHaveLength(1);
    expect(coalesced[0]?.id).toBe(first?.id);
    expect(coalesced[0]?.contentMarkdown).toBe("two");
    expect(coalesced[0]?.lastSavedAt.getTime()).toBeGreaterThanOrEqual(
      first?.lastSavedAt.getTime() ?? 0,
    );

    await put(s.cara, "three");
    expect(await versionRows(page.id)).toHaveLength(2);

    await ageVersions(page.id, 11);
    await put(s.cara, "four");
    const split = await versionRows(page.id);
    expect(split).toHaveLength(3);
    expect(split.map((v) => v.contentMarkdown)).toEqual([
      "two",
      "three",
      "four",
    ]);

    // No content change, no version.
    await put(s.cara, "four");
    expect(await versionRows(page.id)).toHaveLength(3);

    const listed = await s.ok<PageVersionJson[]>(
      s.viewer,
      `/${page.id}/versions`,
    );
    expect(listed.map((v) => v.id)).toEqual(split.map((v) => v.id).reverse());
    expect(listed[0]).not.toHaveProperty("contentJson");
  });

  it("keeps the newest 20 versions", async () => {
    const s = await pageScene();
    const page = await s.create(s.ben);
    for (let index = 0; index < 21; index++) {
      const user = index % 2 === 0 ? s.ben : s.cara;
      await s.ok(
        user,
        `/${page.id}/content`,
        json("PUT", { markdown: `v${index}` }),
      );
    }
    const rows = await versionRows(page.id);
    expect(rows).toHaveLength(20);
    expect(rows[0]?.contentMarkdown).toBe("v1");
    expect(rows[19]?.contentMarkdown).toBe("v20");
  });

  it("restores a version after saving the current content first", async () => {
    const s = await pageScene();
    const page = await s.create(s.ben);
    await s.ok(
      s.ben,
      `/${page.id}/content`,
      json("PUT", { markdown: "original" }),
    );
    await ageVersions(page.id, 11);
    await s.ok(
      s.ben,
      `/${page.id}/content`,
      json("PUT", { markdown: "changed" }),
    );
    const [original] = await versionRows(page.id);
    clearPageEvents();

    const detail = await s.ok<
      PageVersionJson & { contentMarkdown: string; contentJson: unknown }
    >(s.viewer, `/${page.id}/versions/${original?.id}`);
    expect(detail.contentMarkdown).toBe("original");
    expect(detail.contentJson).toMatchObject({ type: "doc" });

    const restored = await s.ok(
      s.cara,
      `/${page.id}/versions/${original?.id}/restore`,
      { method: "POST" },
    );
    expect(restored.contentMarkdown).toBe("original");

    const rows = await versionRows(page.id);
    expect(rows.map((v) => [v.contentMarkdown, v.ownerId])).toEqual([
      ["original", s.ben.id],
      ["changed", s.ben.id],
      ["changed", s.cara.id],
      ["original", s.cara.id],
    ]);
    expect(pageEvents("page.version_restored")[0]?.data).toMatchObject({
      pageId: page.id,
      versionId: original?.id,
      restoredBy: s.cara.id,
    });
    expect(pageEvents("page.content_updated")).toHaveLength(1);
  });

  it("answers 404 for a version of another page", async () => {
    const s = await pageScene();
    const a = await s.create(s.ben);
    const b = await s.create(s.ben);
    await s.ok(s.ben, `/${a.id}/content`, json("PUT", { markdown: "a" }));
    const [version] = await versionRows(a.id);
    const get = await s.call(s.ben, `/${b.id}/versions/${version?.id}`);
    expect(get.status).toBe(404);
    expect(await get.text()).toBe("Version not found");
    const restore = await s.call(
      s.ben,
      `/${b.id}/versions/${version?.id}/restore`,
      {
        method: "POST",
      },
    );
    expect(restore.status).toBe(404);
  });
});
