import { asc, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import { json, type PageScene, pageRow, pageScene } from "./helpers/pages";

async function chain(s: PageScene, depth: number) {
  const ids: string[] = [];
  let parentId: string | null = null;
  for (let level = 1; level <= depth; level++) {
    const page = await s.create(s.ben, { title: `L${level}`, parentId });
    ids.push(page.id);
    parentId = page.id;
  }
  return ids;
}

async function rootOrder(projectId: string) {
  const rows = await db
    .select({ id: schema.pageTable.id, position: schema.pageTable.position })
    .from(schema.pageTable)
    .where(eq(schema.pageTable.projectId, projectId))
    .orderBy(asc(schema.pageTable.position));
  return rows;
}

describe("API integration: page tree", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("creates under a parent and limits nesting to 5 levels", async () => {
    const s = await pageScene();
    const ids = await chain(s, 5);
    const deepest = await s.get(s.ben, ids[4] as string);
    expect(deepest.ancestors).toHaveLength(4);
    expect(deepest.capabilities.canCreateSubpage).toBe(false);

    const tooDeep = await s.call(
      s.ben,
      `/project/${s.project.id}`,
      json("POST", { parentId: ids[4] }),
    );
    expect(tooDeep.status).toBe(400);
    expect(await tooDeep.text()).toBe(
      "Pages can be nested up to 5 levels deep",
    );
  });

  it("refuses to move a 2-level subtree under depth 4", async () => {
    const s = await pageScene();
    const ids = await chain(s, 4);
    const top = await s.create(s.ben, { title: "Top" });
    await s.create(s.ben, { title: "Below", parentId: top.id });

    const response = await s.call(
      s.ben,
      `/${top.id}/position`,
      json("PUT", { parentId: ids[3] }),
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toBe(
      "Pages can be nested up to 5 levels deep",
    );

    // One level less fits.
    await s.ok(s.ben, `/${top.id}/position`, json("PUT", { parentId: ids[2] }));
  });

  it("refuses to move a page inside itself", async () => {
    const s = await pageScene();
    const ids = await chain(s, 3);
    for (const target of [ids[0], ids[2]]) {
      const response = await s.call(
        s.ben,
        `/${ids[0]}/position`,
        json("PUT", { parentId: target }),
      );
      expect(response.status).toBe(400);
      expect(await response.text()).toBe("A page can't be moved inside itself");
    }
  });

  it("applies T4 under a private parent", async () => {
    const s = await pageScene();
    const vault = await s.create(s.ben, { title: "Vault", access: "private" });
    const mine = await s.create(s.ben, { title: "Mine" });
    const mineChild = await s.create(s.ben, {
      title: "Mine child",
      parentId: mine.id,
    });

    const moved = await s.ok(
      s.ben,
      `/${mine.id}/position`,
      json("PUT", { parentId: vault.id }),
    );
    expect(moved.parentId).toBe(vault.id);
    expect(moved.access).toBe("private");
    expect((await pageRow(mineChild.id))?.access).toBe("private");

    const sub = await s.create(s.ben, { title: "Sub", parentId: vault.id });
    expect(sub.access).toBe("private");

    const mixed = await s.create(s.ben, { title: "Mixed" });
    await s.create(s.cara, { title: "Cara's", parentId: mixed.id });
    const refused = await s.call(
      s.ben,
      `/${mixed.id}/position`,
      json("PUT", { parentId: vault.id }),
    );
    expect(refused.status).toBe(409);
    expect(await refused.text()).toBe(
      "Only your own pages can go under a private page",
    );
  });

  it("renumbers siblings with afterId, counting hidden private siblings", async () => {
    const s = await pageScene();
    const a = await s.create(s.ben, { title: "A" });
    const hidden = await s.create(s.cara, {
      title: "Hidden",
      access: "private",
    });
    const b = await s.create(s.ben, { title: "B" });
    const c = await s.create(s.ben, { title: "C" });

    await s.ok(
      s.ben,
      `/${c.id}/position`,
      json("PUT", { parentId: null, afterId: null }),
    );
    expect((await rootOrder(s.project.id)).map((row) => row.id)).toEqual([
      c.id,
      a.id,
      hidden.id,
      b.id,
    ]);

    await s.ok(
      s.ben,
      `/${c.id}/position`,
      json("PUT", { parentId: null, afterId: hidden.id }),
    );
    const order = await rootOrder(s.project.id);
    expect(order.map((row) => row.id)).toEqual([a.id, hidden.id, c.id, b.id]);
    expect(order.map((row) => row.position)).toEqual([0, 1, 2, 3]);

    // Created right after a sibling.
    const d = await s.create(s.ben, { title: "D", afterId: a.id });
    expect(d.position).toBe(1);
    expect((await rootOrder(s.project.id)).map((row) => row.id)).toEqual([
      a.id,
      d.id,
      hidden.id,
      c.id,
      b.id,
    ]);
  });

  it("refuses an afterId outside the destination and a parent of another project", async () => {
    const s = await pageScene();
    const parent = await s.create(s.ben, { title: "Parent" });
    const child = await s.create(s.ben, {
      title: "Child",
      parentId: parent.id,
    });
    const loose = await s.create(s.ben, { title: "Loose" });

    const notSibling = await s.call(
      s.ben,
      `/${loose.id}/position`,
      json("PUT", { parentId: null, afterId: child.id }),
    );
    expect(notSibling.status).toBe(400);
    expect(await notSibling.text()).toBe(
      "afterId must be a sibling in the destination",
    );

    const other = await s.project2();
    const foreign = await s.create(s.ben, { title: "Foreign" }, other.id);
    const crossProject = await s.call(
      s.ben,
      `/${loose.id}/position`,
      json("PUT", { parentId: foreign.id }),
    );
    expect(crossProject.status).toBe(400);
    expect(await crossProject.text()).toBe(
      "The parent page must be in the same project",
    );
  });

  it("refuses an archived parent", async () => {
    const s = await pageScene();
    const parent = await s.create(s.ben, { title: "Parent" });
    await s.ok(s.ben, `/${parent.id}/archive`, { method: "POST" });
    const response = await s.call(
      s.ben,
      `/project/${s.project.id}`,
      json("POST", { parentId: parent.id }),
    );
    expect(response.status).toBe(409);
    expect(await response.text()).toBe(
      "Can't add pages under an archived page",
    );
  });

  it("serializes concurrent moves in one sibling group", async () => {
    const s = await pageScene();
    const pages = [];
    for (const title of ["A", "B", "C", "D", "E"]) {
      pages.push(await s.create(s.ben, { title }));
    }
    const [a, , , d, e] = pages;
    const responses = await Promise.all([
      s.app.request(
        `/api/page/${d?.id}/position`,
        json("PUT", { parentId: null, afterId: null }),
      ),
      s.app.request(
        `/api/page/${a?.id}/position`,
        json("PUT", { parentId: null, afterId: e?.id }),
      ),
    ]);
    for (const response of responses) expect(response.status).toBe(200);

    const rows = await db
      .select({ position: schema.pageTable.position })
      .from(schema.pageTable)
      .where(isNull(schema.pageTable.parentId))
      .orderBy(asc(schema.pageTable.position));
    expect(rows.map((row) => row.position)).toEqual([0, 1, 2, 3, 4]);
  });
});
