import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { json, type PageJson, pageRow, pageScene } from "./helpers/pages";

// 5.5b: publishing a page to a read-only public link. Off unless the
// workspace allows it; the link shows no private data; unpublishing, making
// the page private, archiving it or turning the setting off revokes it.

type Publication = {
  published: boolean;
  token: string | null;
  path: string | null;
  allowed: boolean;
  canPublish: boolean;
  canUnpublish: boolean;
};

type User = typeof schema.userTable.$inferSelect;

async function setup() {
  const s = await pageScene();
  const setAllowed = (user: User, value: boolean) => {
    mockAuthenticatedSession(user);
    return s.app.request(
      `/api/workspace/${s.workspaceId}/settings`,
      json("PATCH", { allowPublicPages: value }),
    );
  };
  const publish = (user: User, pageId: string) =>
    s.call(user, `/${pageId}/publish`, { method: "POST" });
  const read = (token: string) => s.app.request(`/api/public-page/${token}`);
  return { ...s, setAllowed, publish, read };
}

async function allowPublicPages(workspaceId: string, value: boolean) {
  await db
    .update(schema.workspaceTable)
    .set({ allowPublicPages: value })
    .where(eq(schema.workspaceTable.id, workspaceId));
}

describe("public page links", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("stays off until an admin allows public pages, and needs project:share", async () => {
    const s = await setup();
    const page = await s.create(s.ben, { title: "Roadmap" });

    const off = await s.publish(s.admin, page.id);
    expect(off.status).toBe(409);
    const state = await s.ok<Publication>(s.ben, `/${page.id}/publication`);
    expect(state).toMatchObject({ published: false, allowed: false });

    // A member can't turn the setting on; an admin can.
    expect((await s.setAllowed(s.ben, true)).status).toBe(403);
    const allowed = await s.setAllowed(s.admin, true);
    expect(allowed.status, await allowed.clone().text()).toBe(200);
    expect(await allowed.json()).toMatchObject({ allowPublicPages: true });

    const noShare = await s.publish(s.ben, page.id);
    expect(noShare.status).toBe(403);

    const published = await s.publish(s.admin, page.id);
    expect(published.status, await published.clone().text()).toBe(200);
    const body = (await published.json()) as Publication;
    expect(body.published).toBe(true);
    expect(body.token).toMatch(/^[A-Za-z0-9]{22}$/);
    expect(body.path).toBe(`/public-page/${body.token}`);

    // Publishing again keeps the link.
    const again = (await (
      await s.publish(s.admin, page.id)
    ).json()) as Publication;
    expect(again.token).toBe(body.token);
  });

  it("serves the page without signing in, noindex, with no private data", async () => {
    const s = await setup();
    await allowPublicPages(s.workspaceId, true);
    const secret = await s.create(s.ben, {
      title: "Secret plan",
      access: "private",
    });
    const markdown = [
      "# Launch notes",
      "",
      `Ask <margaya-mention id="${s.cara.id}" label="Cara Hidden"></margaya-mention> about it.`,
      "",
      `<margaya-issue-link url="http://localhost:5173/dashboard/workspace/${s.workspaceId}/project/${s.project.id}/task/task-xyz" issue-key="WEB-42" task-id="task-xyz" />`,
      "",
      `See <margaya-page-link id="${secret.id}" title="Secret plan"></margaya-page-link>.`,
      "",
      `<margaya-attachment url="http://localhost:1337/api/asset/asset-private" filename="salaries.xlsx" mime-type="application/vnd.ms-excel" size="10" />`,
      "",
      "[docs](https://example.com/docs) and [bad](javascript:alert(1))",
    ].join("\n");
    const page = await s.create(s.ben, { title: "Launch", content: markdown });
    const { token } = (await (
      await s.publish(s.admin, page.id)
    ).json()) as Publication;

    const response = await s.read(token ?? "");
    expect(response.status, await response.clone().text()).toBe(200);
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    const body = JSON.parse(text) as { title: string; content: unknown };
    expect(body.title).toBe("Launch");
    expect(text).toContain("Launch notes");
    expect(text).toContain("https://example.com/docs");
    for (const leak of [
      "Cara Hidden",
      s.cara.id,
      "WEB-42",
      "task-xyz",
      secret.id,
      "Secret plan",
      "salaries.xlsx",
      "asset-private",
      "javascript:",
      s.workspaceId,
      s.project.id,
      s.ben.id,
    ]) {
      expect(text, leak).not.toContain(leak);
    }
    expect(text).toContain('"kind":"mention"');
    expect(text).toContain('"kind":"task"');
    expect(text).toContain('"kind":"page"');
    expect(text).toContain('"kind":"attachment"');

    // Files the page does not show as images are never served.
    const file = await s.app.request(
      `/api/public-page/${token}/asset/asset-private`,
    );
    expect(file.status).toBe(404);
  });

  it("links to another page only when that page is published too", async () => {
    const s = await setup();
    await allowPublicPages(s.workspaceId, true);
    const target = await s.create(s.ben, { title: "Changelog" });
    const page = await s.create(s.ben, {
      title: "Home",
      content: `Read <margaya-page-link id="${target.id}" title="Changelog"></margaya-page-link>`,
    });
    const home = (await (
      await s.publish(s.admin, page.id)
    ).json()) as Publication;
    const before = await (await s.read(home.token ?? "")).text();
    expect(before).not.toContain(target.id);

    const changelog = (await (
      await s.publish(s.admin, target.id)
    ).json()) as Publication;
    const after = await (await s.read(home.token ?? "")).text();
    expect(after).toContain(`"token":"${changelog.token}"`);
    expect(after).toContain('"title":"Changelog"');
    expect(after).not.toContain(target.id);
  });

  it("revokes the link on unpublish: the old token answers 404, a republish gets a new one", async () => {
    const s = await setup();
    await allowPublicPages(s.workspaceId, true);
    const page = await s.create(s.ben, { title: "Roadmap" });
    const first = (await (
      await s.publish(s.admin, page.id)
    ).json()) as Publication;
    expect((await s.read(first.token ?? "")).status).toBe(200);

    const byMember = await s.call(s.ben, `/${page.id}/unpublish`, {
      method: "POST",
    });
    expect(byMember.status).toBe(403);
    const unpublished = await s.call(s.admin, `/${page.id}/unpublish`, {
      method: "POST",
    });
    expect(unpublished.status).toBe(200);
    expect(((await unpublished.json()) as Publication).published).toBe(false);
    expect((await s.read(first.token ?? "")).status).toBe(404);
    expect((await pageRow(page.id))?.publicToken).toBeNull();

    const second = (await (
      await s.publish(s.admin, page.id)
    ).json()) as Publication;
    expect(second.token).not.toBe(first.token);
    expect((await s.read(first.token ?? "")).status).toBe(404);
    expect((await s.read(second.token ?? "")).status).toBe(200);
  });

  it("revokes links when the page goes private or is archived, or the workspace turns them off", async () => {
    const s = await setup();
    await allowPublicPages(s.workspaceId, true);
    const own = await s.create(s.admin, { title: "Mine" });
    const shared = await s.create(s.ben, { title: "Shared" });
    const other = await s.create(s.ben, { title: "Other" });
    const tokens = await Promise.all(
      [own, shared, other].map(async (page: PageJson) => {
        const body = (await (
          await s.publish(s.admin, page.id)
        ).json()) as Publication;
        return body.token ?? "";
      }),
    );

    // Private pages can't be published, and going private revokes.
    await s.ok(
      s.admin,
      `/${own.id}/access`,
      json("PUT", { access: "private" }),
    );
    expect((await s.read(tokens[0] ?? "")).status).toBe(404);
    expect((await s.publish(s.admin, own.id)).status).toBe(409);

    await s.ok(s.ben, `/${shared.id}/archive`, { method: "POST" });
    expect((await s.read(tokens[1] ?? "")).status).toBe(404);
    await s.ok(s.ben, `/${shared.id}/unarchive`, { method: "POST" });
    expect((await s.read(tokens[1] ?? "")).status).toBe(404);

    expect((await s.read(tokens[2] ?? "")).status).toBe(200);
    const off = await s.setAllowed(s.owner, false);
    expect(off.status, await off.clone().text()).toBe(200);
    expect((await s.read(tokens[2] ?? "")).status).toBe(404);
    expect((await pageRow(other.id))?.publicToken).toBeNull();
  });

  it("answers 404 for malformed or unknown tokens, and while the workspace is pending deletion", async () => {
    const s = await setup();
    await allowPublicPages(s.workspaceId, true);
    expect((await s.read("short")).status).toBe(404);
    expect((await s.read("A".repeat(22))).status).toBe(404);

    const page = await s.create(s.ben, { title: "Roadmap" });
    const { token } = (await (
      await s.publish(s.admin, page.id)
    ).json()) as Publication;
    await db
      .update(schema.workspaceTable)
      .set({ deletionDueAt: new Date(Date.now() + 86_400_000) })
      .where(eq(schema.workspaceTable.id, s.workspaceId));
    expect((await s.read(token ?? "")).status).toBe(404);
  });
});
