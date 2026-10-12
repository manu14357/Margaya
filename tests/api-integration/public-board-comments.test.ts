import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { setPublicBoardInstanceState } from "../../apps/api/src/public-board/instance-state";
import { SANITIZE_MESSAGES } from "../../apps/api/src/public-board/sanitize";
import { resetTestDatabase } from "./helpers/database";
import { assignTask } from "./helpers/fixtures";
import {
  clearPublishedEvents,
  publishedEvents,
  recordEvents,
  settle,
} from "./helpers/intake";
import {
  ALL_ON,
  boardScene,
  json,
  resetPublicBoardState,
} from "./helpers/public-board";

type PublicComment = {
  id: string;
  content: string;
  edited: boolean;
  author: { name: string; badge: string | null; isYou: boolean };
  can: { edit: boolean; delete: boolean };
};

beforeEach(async () => {
  await resetTestDatabase();
  resetPublicBoardState();
  recordEvents("comment.created", "comment.updated", "comment.deleted");
  clearPublishedEvents();
});
afterAll(() => setPublicBoardInstanceState(null));

async function scene(settings: Record<string, unknown> = ALL_ON) {
  const base = await boardScene();
  const token = await base.publish(settings);
  const task = await base.createTask("Feedback wanted");
  const commentsPath = `/public-board/${token}/tasks/${task.number}/comments`;
  const post = (user: Parameters<typeof base.as>[0], content: string) =>
    base.as(user)(commentsPath, json("POST", { content }));
  return { ...base, token, task, commentsPath, post };
}

describe("public board comments", () => {
  it("refuses visitors, API keys, and boards with comments off", async () => {
    const s = await scene();
    const visitor = await s.post(null, "hi");
    expect(visitor.status).toBe(401);
    expect(await visitor.text()).toBe("Sign in to take part");
    const apiKey = await s.app.request(`/api${s.commentsPath}`, {
      ...json("POST", { content: "hi" }),
      headers: { "content-type": "application/json", "x-api-key": "k" },
    });
    expect(apiKey.status).toBe(403);
    expect(await apiKey.text()).toBe("Use a signed-in session to take part");

    const off = await scene({ ...ALL_ON, commentsEnabled: false });
    const refused = await off.post(off.outsider, "hi");
    expect(refused.status).toBe(403);
    expect(await refused.text()).toBe("Comments are turned off for this board");
    expect((await off.as(null)(off.commentsPath)).status).toBe(403);
  });

  it("stores an outsider's comment as a public activity comment", async () => {
    const s = await scene();
    await assignTask(s.task.id, [s.member.id]);
    const response = await s.post(
      s.outsider,
      'Love it <b>a lot</b> <margaya-mention id="' +
        s.member.id +
        '" label="Ben"></margaya-mention> ![x](https://img.test/x.png)',
    );
    expect(response.status, await response.clone().text()).toBe(201);
    const comment = (await response.json()) as PublicComment;
    expect(comment).toMatchObject({
      content: "Love it a lot @Ben [x](https://img.test/x.png)",
      edited: false,
      author: { name: "Oz", badge: null, isYou: true },
      can: { edit: true, delete: true },
    });

    const [row] = await db
      .select()
      .from(schema.activityTable)
      .where(eq(schema.activityTable.id, comment.id));
    expect(row).toMatchObject({
      type: "comment",
      visibility: "public",
      userId: s.outsider.id,
    });
    expect(publishedEvents("comment.created")[0]?.data).toMatchObject({
      visibility: "public",
      origin: "public_board",
    });

    // The app's comment list shows it with the author's flags.
    const appList = await s.as(s.owner)(`/comment/${s.task.id}`);
    const listed = (await appList.json()) as Array<Record<string, unknown>>;
    expect(listed[0]).toMatchObject({
      visibility: "public",
      user: { name: "Oz", isWorkspaceMember: false, isGuest: false },
    });

    await settle();
    // No mention notification for the pasted mention; the assignee hears
    // about the comment; the outsider doesn't start watching the task.
    const notifications = await db
      .select()
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.userId, s.member.id));
    expect(notifications.map((n) => n.type)).not.toContain("task_mention");
    expect(notifications.map((n) => n.type)).toContain("task_comment");
    const watching = await db
      .select()
      .from(schema.taskSubscriberTable)
      .where(
        and(
          eq(schema.taskSubscriberTable.taskId, s.task.id),
          eq(schema.taskSubscriberTable.userId, s.outsider.id),
        ),
      );
    expect(watching).toHaveLength(0);
  });

  it("lists only public comments, oldest first, with badges", async () => {
    const s = await scene();
    await s.post(s.outsider, "first");
    await s.post(s.member, "second");
    await s.as(s.owner)(
      `/comment/${s.task.id}`,
      json("POST", { content: "internal note" }),
    );
    const page = (await (
      await s.as(null)(`${s.commentsPath}?limit=1`)
    ).json()) as { items: PublicComment[]; nextCursor: string | null };
    expect(page.items.map((c) => c.content)).toEqual(["first"]);
    expect(page.items[0]?.can).toEqual({ edit: false, delete: false });
    const rest = (await (
      await s.as(s.member)(
        `${s.commentsPath}?cursor=${encodeURIComponent(page.nextCursor ?? "")}`,
      )
    ).json()) as { items: PublicComment[]; nextCursor: string | null };
    expect(rest.items.map((c) => [c.content, c.author.badge])).toEqual([
      ["second", "member"],
    ]);
    expect(rest.nextCursor).toBeNull();
  });

  it("lets authors edit and delete their own comments only", async () => {
    const s = await scene();
    const mine = (await (
      await s.post(s.outsider, "typo")
    ).json()) as PublicComment;
    const path = `/public-board/${s.token}/comments/${mine.id}`;
    const edited = await s.as(s.outsider)(
      path,
      json("PATCH", { content: "fixed <i>it</i>" }),
    );
    expect(edited.status).toBe(200);
    expect(((await edited.json()) as PublicComment).content).toBe("fixed it");
    expect(publishedEvents("comment.updated")[0]?.data).toMatchObject({
      origin: "public_board",
    });

    const other = await s.as(s.member)(path, json("PATCH", { content: "x" }));
    expect(other.status).toBe(403);
    expect(await other.text()).toBe("You can only change your own comments");
    expect((await s.as(s.member)(path, { method: "DELETE" })).status).toBe(403);

    const deleted = await s.as(s.outsider)(path, { method: "DELETE" });
    expect(await deleted.json()).toEqual({ id: mine.id });
    expect((await s.as(s.outsider)(path, { method: "DELETE" })).status).toBe(
      404,
    );
  });

  it("follows the guest rules, including managing their own comment later", async () => {
    const closed = await scene({ ...ALL_ON, allowGuests: false });
    const refused = await closed.post(closed.guest, "hello");
    expect(refused.status).toBe(403);
    expect(await refused.text()).toBe(
      "This board needs an account to take part",
    );

    const s = await scene();
    const created = await s.post(s.guest, "guest hello");
    expect(created.status).toBe(201);
    const comment = (await created.json()) as PublicComment;
    expect(comment.author.badge).toBe("guest");
    await s.as(s.owner)(
      `/publication/project/${s.project.id}`,
      json("PATCH", { allowGuests: false }),
    );
    const deleted = await s.as(s.guest)(
      `/public-board/${s.token}/comments/${comment.id}`,
      { method: "DELETE" },
    );
    expect(deleted.status).toBe(200);
  });

  it("sanitizes and bounds content", async () => {
    const s = await scene();
    const empty = await s.post(s.outsider, "<b> </b>");
    expect(empty.status).toBe(400);
    expect(await empty.text()).toBe(SANITIZE_MESSAGES.emptyComment);
    const long = await s.post(s.outsider, "x".repeat(5001));
    expect(await long.text()).toBe(SANITIZE_MESSAGES.longComment);
    const links = Array.from(
      { length: 11 },
      (_, i) => `https://l${i}.test`,
    ).join(" ");
    expect(await (await s.post(s.outsider, links)).text()).toBe(
      SANITIZE_MESSAGES.commentLinks,
    );
    const huge = await s.post(s.outsider, "y".repeat(40_000));
    expect(huge.status).toBe(413);
  });

  it("refuses blocked, banned and paused participation", async () => {
    const s = await scene();
    const banned = { ...s.outsider, banned: true, banExpires: null };
    expect((await s.post(banned, "hi")).status).toBe(403);

    await s.as(s.owner)(
      `/publication/project/${s.project.id}/blocks/${s.member.id}`,
      json("PUT", {}),
    );
    const blocked = await s.post(s.member, "hi");
    expect(blocked.status).toBe(403);
    expect(await blocked.text()).toBe("You can't take part on this board");
    // Reads keep working.
    expect((await s.as(s.member)(s.commentsPath)).status).toBe(200);

    resetPublicBoardState({ participation: false });
    const paused = await s.post(s.outsider, "hi");
    expect(await paused.text()).toBe(
      "Public participation is turned off on this server",
    );
  });

  it("limits each account to 6 comments a minute", async () => {
    const s = await scene();
    for (let i = 0; i < 6; i += 1) {
      expect((await s.post(s.outsider, `comment ${i}`)).status).toBe(201);
    }
    const limited = await s.post(s.outsider, "one too many");
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await limited.text()).toMatch(
      /^You're doing that too often\. Try again in \d+ seconds\.$/,
    );
    // Another account is unaffected.
    expect((await s.post(s.member, "still fine")).status).toBe(201);
  });
});
