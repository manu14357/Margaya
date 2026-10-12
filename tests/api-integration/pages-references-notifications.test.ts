import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";
import { json, type PageSummaryJson, pageScene } from "./helpers/pages";

function mention(user: { id: string; name: string }) {
  return `<margaya-mention id="${user.id}" label="${user.name}"></margaya-mention>`;
}

function pageLink(pageId: string) {
  return `<margaya-page-link id="${pageId}" title="Linked"></margaya-page-link>`;
}

async function mentionNotifications(userId: string) {
  return db
    .select()
    .from(schema.notificationTable)
    .where(
      and(
        eq(schema.notificationTable.userId, userId),
        eq(schema.notificationTable.type, "page_mention"),
      ),
    );
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 150));
}

describe("API integration: page references and mention notifications", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("notifies newly mentioned members once per appearance", async () => {
    const s = await pageScene();
    const page = await s.create(s.ben, {
      title: "Plan",
      content: `Hi ${mention(s.cara)}`,
    });
    await vi.waitFor(async () =>
      expect(await mentionNotifications(s.cara.id)).toHaveLength(1),
    );
    const [first] = await mentionNotifications(s.cara.id);
    expect(first).toMatchObject({
      resourceType: "page",
      resourceId: page.id,
      actorId: s.ben.id,
      workspaceId: s.workspaceId,
    });
    expect(first?.eventData).toMatchObject({
      pageTitle: "Plan",
      mentionerName: "Ben",
      projectId: s.project.id,
      workspaceId: s.workspaceId,
    });

    const put = (markdown: string) =>
      s.ok(s.ben, `/${page.id}/content`, json("PUT", { markdown }));
    await put(`Hi again ${mention(s.cara)}`);
    await settle();
    expect(await mentionNotifications(s.cara.id)).toHaveLength(1);

    await put("Nobody");
    await put(`Back ${mention(s.cara)}`);
    await vi.waitFor(async () =>
      expect(await mentionNotifications(s.cara.id)).toHaveLength(2),
    );
  });

  it("skips the actor, non-members and people who can't see the page", async () => {
    const s = await pageScene();
    const outsider = await createWorkspaceMember();
    await s.create(s.ben, {
      content: `${mention(s.ben)} ${mention(outsider.user)}`,
    });
    const secret = await s.create(s.ben, { access: "private" });
    await s.ok(
      s.ben,
      `/${secret.id}/content`,
      json("PUT", { markdown: mention(s.cara) }),
    );
    await settle();
    expect(await mentionNotifications(s.ben.id)).toHaveLength(0);
    expect(await mentionNotifications(outsider.user.id)).toHaveLength(0);
    expect(await mentionNotifications(s.cara.id)).toHaveLength(0);
  });

  it("lists visible, non-archived backlinks", async () => {
    const s = await pageScene();
    const target = await s.create(s.ben, { title: "Target" });
    const visible = await s.create(s.cara, {
      title: "Visible",
      content: pageLink(target.id),
    });
    await s.create(s.cara, {
      title: "Private",
      access: "private",
      content: pageLink(target.id),
    });
    const archived = await s.create(s.cara, {
      title: "Archived",
      content: pageLink(target.id),
    });
    await s.ok(s.cara, `/${archived.id}/archive`, { method: "POST" });
    await s.ok(
      s.ben,
      `/${target.id}/content`,
      json("PUT", { markdown: pageLink(target.id) }),
    );

    const forBen = await s.ok<PageSummaryJson[]>(
      s.ben,
      `/${target.id}/backlinks`,
    );
    expect(forBen.map((p) => p.id)).toEqual([visible.id]);
    const forCara = await s.ok<PageSummaryJson[]>(
      s.cara,
      `/${target.id}/backlinks`,
    );
    expect(forCara.map((p) => p.title).sort()).toEqual(["Private", "Visible"]);

    // Self-links are not references.
    const own = await db
      .select()
      .from(schema.pageReferenceTable)
      .where(eq(schema.pageReferenceTable.pageId, target.id));
    expect(own).toHaveLength(0);
  });

  it("lists the pages that link a task, by id or by key", async () => {
    const s = await pageScene();
    const [task] = await db
      .insert(schema.taskTable)
      .values({ projectId: s.project.id, title: "Ship", number: 7 })
      .returning();
    const byId = await s.create(s.ben, {
      title: "By id",
      content: `<margaya-issue-link url="https://x.test/t" issue-key="WEB-7" task-id="${task?.id}" />`,
    });
    const byKey = await s.create(s.ben, {
      title: "By key",
      content:
        '<margaya-issue-link url="https://x.test/t" issue-key="WEB-7" task-id="" />',
    });
    await s.create(s.ben, { title: "Unrelated" });

    mockAuthenticatedSession(s.viewer);
    const response = await s.app.request(
      `/api/page/task/${task?.id}/references`,
    );
    expect(response.status).toBe(200);
    const pages = (await response.json()) as PageSummaryJson[];
    expect(pages.map((p) => p.id).sort()).toEqual([byId.id, byKey.id].sort());
  });
});
