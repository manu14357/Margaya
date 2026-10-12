import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { submitIntakeItem } from "../../apps/api/src/intake/service";
import { BOARD_NOT_FOUND } from "../../apps/api/src/public-board/board";
import { setPublicBoardInstanceState } from "../../apps/api/src/public-board/instance-state";
import { resetTestDatabase } from "./helpers/database";
import { assignTask } from "./helpers/fixtures";
import {
  ALL_ON,
  boardScene,
  json,
  jsonStrings,
  resetPublicBoardState,
} from "./helpers/public-board";

// biome-ignore lint/suspicious/noExplicitAny: loose JSON for matcher assertions
type Loose = Record<string, any>;

type TaskPage = {
  groups: Array<{
    key: string;
    count: number;
    taskIds: string[];
    nextCursor: string | null;
  }>;
  tasks: Record<string, Record<string, unknown>>;
  totalCount: number;
};

beforeEach(async () => {
  await resetTestDatabase();
  resetPublicBoardState();
});
afterAll(() => setPublicBoardInstanceState(null));

async function readJson<T>(response: Response, status = 200): Promise<T> {
  expect(response.status, await response.clone().text()).toBe(status);
  return (await response.json()) as T;
}

describe("public board reads", () => {
  it("describes the board for visitors, guests, outsiders and members", async () => {
    const scene = await boardScene();
    const token = await scene.publish();
    const task = await scene.createTask("Labelled");
    await db.insert(schema.labelTable).values([
      { name: "ui", color: "#111111", taskId: task.id },
      {
        name: "ui",
        color: "#222222",
        workspaceId: scene.workspaceId,
      },
      { name: "unused", color: "#333333", workspaceId: scene.workspaceId },
    ]);

    const visitor = await readJson<Loose>(
      await scene.as(null)(`/public-board/${token}`),
    );
    expect(visitor.project).toMatchObject({ name: scene.project.name });
    expect(visitor.board).toMatchObject({
      layouts: ["board", "list"],
      comments: true,
      votes: true,
      requests: true,
      guestsAllowed: true,
      showBacklog: false,
    });
    expect(visitor.participation).toBe(true);
    expect(visitor.columns.map((c: { slug: string }) => c.slug)).toEqual([
      "to-do",
      "in-progress",
      "in-review",
      "done",
    ]);
    // Only labels a visible task uses; the workspace label's color wins.
    expect(visitor.labels).toEqual([{ name: "ui", color: "#222222" }]);
    expect(visitor.sorts).toContain("votes");
    expect(visitor.reactionSet).toContain("thumbs_up");
    expect(visitor.viewer).toEqual({
      kind: "visitor",
      name: null,
      image: null,
      isMember: false,
      blocked: false,
      can: { comment: false, react: false, vote: false, request: false },
    });
    expect(visitor.instance).toEqual({
      name: "Margaya",
      guestSignInAvailable: true,
      signUpAvailable: true,
    });

    const guest = await readJson<Loose>(
      await scene.as(scene.guest)(`/public-board/${token}`),
    );
    expect(guest.viewer).toMatchObject({
      kind: "guest",
      name: "Gus",
      can: { comment: true, react: true, vote: false, request: false },
    });
    const outsider = await readJson<Loose>(
      await scene.as(scene.outsider)(`/public-board/${token}`),
    );
    expect(outsider.viewer).toMatchObject({
      kind: "account",
      isMember: false,
      can: { comment: true, react: true, vote: true, request: true },
    });
    const member = await readJson<Loose>(
      await scene.as(scene.member)(`/public-board/${token}`),
    );
    expect(member.viewer.isMember).toBe(true);
  });

  it("answers the same 404 for unknown, unpublished, archived and switched-off boards", async () => {
    const scene = await boardScene();
    const token = await scene.publish();
    const visitor = scene.as(null);
    const expectGone = async (path: string) => {
      const response = await visitor(path);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe(BOARD_NOT_FOUND);
    };
    expect((await visitor(`/public-board/${token}`)).status).toBe(200);
    await expectGone("/public-board/unknown-token-1234567890");
    await expectGone("/public-board/bad!token");
    await expectGone(`/public-board/${"a".repeat(65)}`);

    resetPublicBoardState({ publicBoards: false });
    await expectGone(`/public-board/${token}`);
    await expectGone(`/public-board/${token}/tasks`);
    resetPublicBoardState();

    await db
      .update(schema.projectTable)
      .set({ archivedAt: new Date() })
      .where(eq(schema.projectTable.id, scene.project.id));
    await expectGone(`/public-board/${token}`);
    await db
      .update(schema.projectTable)
      .set({ archivedAt: null })
      .where(eq(schema.projectTable.id, scene.project.id));

    const unpublish = await scene.as(scene.owner)(
      `/publication/project/${scene.project.id}/unpublish`,
      { method: "POST" },
    );
    expect(unpublish.status).toBe(200);
    await expectGone(`/public-board/${token}`);
  });

  it("lists visible tasks by column, hiding archived, triage and backlog tasks", async () => {
    const scene = await boardScene();
    const token = await scene.publish();
    const open = await scene.createTask("Open bug", { priority: "high" });
    const done = await scene.createTask("Shipped", {
      status: "done",
      columnId: scene.columns.done.id,
    });
    await scene.createTask("Archived", { archivedAt: new Date() });
    const planned = await scene.createTask("Someday", {
      status: "planned",
      columnId: null,
    });
    const request = await submitIntakeItem({
      projectId: scene.project.id,
      submittedBy: scene.member.id,
      title: "In triage",
      source: "in_app",
    });

    const page = await readJson<TaskPage>(
      await scene.as(null)(`/public-board/${token}/tasks`),
    );
    const ids = page.groups.flatMap((group) => group.taskIds);
    expect(ids.sort()).toEqual([open.id, done.id].sort());
    expect(page.totalCount).toBe(2);
    expect(page.groups.map((group) => group.key)).not.toContain("planned");
    expect(ids).not.toContain(request.taskId);
    expect(page.groups.find((group) => group.key === "to-do")?.count).toBe(1);
    expect(page.tasks[open.id]).toMatchObject({
      title: "Open bug",
      key: `WEB-${open.number}`,
      priority: "high",
      counts: { votesUp: 0, votesDown: 0, reactions: [], comments: 0 },
    });
    expect(page.tasks[open.id]).not.toHaveProperty("assignees");

    // The backlog shows as a planned group once turned on.
    await scene.as(scene.owner)(
      `/publication/project/${scene.project.id}`,
      json("PATCH", { showBacklog: true }),
    );
    const withBacklog = await readJson<TaskPage>(
      await scene.as(null)(`/public-board/${token}/tasks`),
    );
    expect(
      withBacklog.groups.find((group) => group.key === "planned")?.taskIds,
    ).toEqual([planned.id]);
  });

  it("filters, searches and sorts, refusing a votes sort with votes off", async () => {
    const scene = await boardScene();
    const token = await scene.publish({ ...ALL_ON, votesEnabled: false });
    const high = await scene.createTask("Dark mode", { priority: "high" });
    const low = await scene.createTask("Light mode", { priority: "low" });
    await db
      .insert(schema.labelTable)
      .values({ name: "ui", color: "#123456", taskId: low.id });
    const ids = async (query: string) => {
      const page = await readJson<TaskPage>(
        await scene.as(null)(`/public-board/${token}/tasks?${query}`),
      );
      return page.groups.flatMap((group) => group.taskIds);
    };
    expect(await ids("priority=high,nonsense")).toEqual([high.id]);
    expect(await ids("label=ui")).toEqual([low.id]);
    expect(await ids("q=dark")).toEqual([high.id]);
    expect(await ids(`q=WEB-${low.number}`)).toEqual([low.id]);
    expect(await ids("status=done")).toEqual([]);
    expect((await ids("sort=newest")).length).toBe(2);
    const votes = await scene.as(null)(
      `/public-board/${token}/tasks?sort=votes`,
    );
    expect(votes.status).toBe(400);
    expect(await votes.text()).toBe("Sorting by votes needs votes turned on");
  });

  it("pages one column to its end and refuses a stale cursor", async () => {
    const scene = await boardScene();
    const token = await scene.publish();
    const created = [];
    for (let i = 0; i < 5; i += 1) {
      created.push(await scene.createTask(`Task ${i}`, { position: i }));
    }
    const seen: string[] = [];
    let page = await readJson<TaskPage>(
      await scene.as(null)(`/public-board/${token}/tasks?limit=2`),
    );
    let group = page.groups.find((g) => g.key === "to-do");
    seen.push(...(group?.taskIds ?? []));
    while (group?.nextCursor) {
      page = await readJson<TaskPage>(
        await scene.as(null)(
          `/public-board/${token}/tasks?limit=2&group=to-do&cursor=${encodeURIComponent(group.nextCursor)}`,
        ),
      );
      group = page.groups.find((g) => g.key === "to-do");
      seen.push(...(group?.taskIds ?? []));
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    const stale = await scene.as(null)(
      `/public-board/${token}/tasks?limit=2&group=to-do&cursor=garbage`,
    );
    expect(stale.status).toBe(400);
  });

  it("keeps people private: no user ids or emails, assignees only when shown", async () => {
    const scene = await boardScene();
    const token = await scene.publish({ ...ALL_ON, showAssignees: false });
    const task = await scene.createTask("Assigned");
    await assignTask(task.id, [scene.member.id]);
    await scene.as(scene.outsider)(
      `/public-board/${token}/tasks/${task.number}/comments`,
      json("POST", { content: "Looks great" }),
    );
    await scene.as(scene.outsider)(
      `/public-board/${token}/tasks/${task.number}/vote`,
      json("PUT", { value: 1 }),
    );
    await scene.as(scene.outsider)(
      `/public-board/${token}/tasks/${task.number}/reactions/heart`,
      { method: "PUT" },
    );
    const secrets = [
      scene.owner.id,
      scene.member.id,
      scene.outsider.id,
      scene.owner.email,
      scene.member.email,
      scene.outsider.email,
    ];
    const reads = [
      `/public-board/${token}`,
      `/public-board/${token}/tasks`,
      `/public-board/${token}/tasks/${task.number}`,
      `/public-board/${token}/tasks/${task.number}/description`,
      `/public-board/${token}/tasks/${task.number}/comments`,
    ];
    for (const viewer of [null, scene.outsider]) {
      for (const path of reads) {
        const body = await readJson<unknown>(await scene.as(viewer)(path));
        const strings = jsonStrings(body).join("\n");
        for (const secret of secrets) {
          expect(strings, path).not.toContain(secret);
        }
        expect(strings, path).not.toContain("Ben");
      }
    }

    await scene.as(scene.owner)(
      `/publication/project/${scene.project.id}`,
      json("PATCH", { showAssignees: true }),
    );
    const page = await readJson<TaskPage>(
      await scene.as(null)(`/public-board/${token}/tasks`),
    );
    expect(page.tasks[task.id]?.assignees).toEqual([
      { name: "Ben", image: scene.member.image },
    ]);
    const detail = await readJson<Record<string, unknown>>(
      await scene.as(null)(`/public-board/${token}/tasks/${task.number}`),
    );
    expect(detail.assignees).toEqual([
      { name: "Ben", image: scene.member.image },
    ]);
  });

  it("reads one task and its description, 404 for hidden and foreign tasks", async () => {
    const scene = await boardScene();
    const token = await scene.publish();
    const task = await scene.createTask("Readable", {
      description: "Hello **world**",
    });
    const archived = await scene.createTask("Gone", {
      archivedAt: new Date(),
    });
    const other = await boardScene();
    const foreign = await other.createTask("Elsewhere", { number: 5000 });

    const detail = await readJson<Loose>(
      await scene.as(scene.outsider)(
        `/public-board/${token}/tasks/${task.number}`,
      ),
    );
    expect(detail).toMatchObject({
      id: task.id,
      title: "Readable",
      column: { name: "To Do", group: "unstarted", isFinal: false },
      description: "Hello **world**",
      descriptionDeferred: false,
      votes: { up: 0, down: 0, mine: null },
      reactions: [],
      commentCount: 0,
      can: { comment: true, react: true, vote: true },
      externalLinks: [],
    });
    const description = await readJson<Record<string, unknown>>(
      await scene.as(null)(
        `/public-board/${token}/tasks/${task.number}/description`,
      ),
    );
    expect(description).toMatchObject({
      content: "Hello **world**",
      nextOffset: null,
    });
    for (const number of [archived.number, foreign.number, 0, "abc", "1e3"]) {
      const response = await scene.as(null)(
        `/public-board/${token}/tasks/${number}`,
      );
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("This task isn't on the board");
    }
  });

  it("keeps the deprecated public-project routes working through the resolver", async () => {
    const scene = await boardScene();
    // A board published through the legacy flag keeps the project id link.
    const legacy = await scene.as(scene.owner)(
      `/project/${scene.project.id}`,
      json("PUT", {
        name: scene.project.name,
        icon: scene.project.icon,
        slug: scene.project.slug,
        description: "",
        isPublic: true,
      }),
    );
    expect(legacy.status, await legacy.clone().text()).toBe(200);
    const task = await scene.createTask("Legacy");
    await assignTask(task.id, [scene.member.id]);

    const board = await readJson<{
      columns: Array<{ tasks: Array<Record<string, unknown>> }>;
    }>(await scene.as(null)(`/public-project/${scene.project.id}`));
    const legacyTask = board.columns.flatMap((column) => column.tasks)[0];
    expect(legacyTask?.assignees).toEqual([
      expect.objectContaining({ name: "Ben" }),
    ]);

    await scene.as(scene.owner)(
      `/publication/project/${scene.project.id}`,
      json("PATCH", { showAssignees: false }),
    );
    const hidden = await readJson<{
      columns: Array<{ tasks: Array<Record<string, unknown>> }>;
    }>(await scene.as(null)(`/public-project/${scene.project.id}`));
    const hiddenTask = hidden.columns.flatMap((column) => column.tasks)[0];
    expect(hiddenTask).toMatchObject({
      assignees: [],
      assigneeIds: [],
      userId: null,
      assigneeName: null,
    });

    const description = await scene.as(null)(
      `/public-project/${scene.project.id}/task/${task.id}/description`,
    );
    expect(description.status).toBe(200);
    expect(description.headers.get("X-Robots-Tag")).toBe("noindex");

    await scene.as(scene.owner)(
      `/project/${scene.project.id}`,
      json("PUT", {
        name: scene.project.name,
        icon: scene.project.icon,
        slug: scene.project.slug,
        description: "",
        isPublic: false,
      }),
    );
    expect(
      (await scene.as(null)(`/public-project/${scene.project.id}`)).status,
    ).toBe(404);
  });

  it("sets privacy headers and lets unpublish win over the list cache", async () => {
    const scene = await boardScene();
    const token = await scene.publish();
    await scene.createTask("Cached");
    const first = await scene.as(null)(`/public-board/${token}/tasks`);
    expect(first.status).toBe(200);
    expect(first.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(first.headers.get("Cache-Control")).toBe("no-store");
    const missing = await scene.as(null)("/public-board/nope-nope-nope-nope");
    expect(missing.headers.get("X-Robots-Tag")).toBe("noindex");

    // A second identical request is served from the cache: a task added in
    // between doesn't show yet.
    await scene.createTask("Added later");
    const cached = await readJson<TaskPage>(
      await scene.as(null)(`/public-board/${token}/tasks`),
    );
    expect(cached.totalCount).toBe(1);

    await scene.as(scene.owner)(
      `/publication/project/${scene.project.id}/unpublish`,
      { method: "POST" },
    );
    expect((await scene.as(null)(`/public-board/${token}/tasks`)).status).toBe(
      404,
    );
  });
});
