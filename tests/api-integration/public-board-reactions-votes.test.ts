import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { setPublicBoardInstanceState } from "../../apps/api/src/public-board/instance-state";
import { resetTestDatabase } from "./helpers/database";
import {
  clearPublishedEvents,
  publishedEvents,
  recordEvents,
} from "./helpers/intake";
import {
  ALL_ON,
  boardScene,
  json,
  resetPublicBoardState,
} from "./helpers/public-board";

beforeEach(async () => {
  await resetTestDatabase();
  resetPublicBoardState();
  recordEvents("task.vote_changed", "reaction.added", "reaction.removed");
  clearPublishedEvents();
});
afterAll(() => setPublicBoardInstanceState(null));

async function scene(settings: Record<string, unknown> = ALL_ON) {
  const base = await boardScene();
  const token = await base.publish(settings);
  const task = await base.createTask("Vote on me");
  const taskPath = `/public-board/${token}/tasks/${task.number}`;
  return { ...base, token, task, taskPath };
}

describe("public board reactions", () => {
  it("adds and removes task reactions idempotently, counts without names", async () => {
    const s = await scene();
    const add = () =>
      s.as(s.outsider)(`${s.taskPath}/reactions/heart`, { method: "PUT" });
    const first = await add();
    expect(first.status, await first.clone().text()).toBe(200);
    expect(await first.json()).toEqual([
      { emoji: "heart", count: 1, reacted: true },
    ]);
    expect(await (await add()).json()).toEqual([
      { emoji: "heart", count: 1, reacted: true },
    ]);
    expect(publishedEvents("reaction.added")).toHaveLength(1);

    const other = await s.as(s.member)(`${s.taskPath}/reactions/heart`, {
      method: "PUT",
    });
    expect(await other.json()).toEqual([
      { emoji: "heart", count: 2, reacted: true },
    ]);

    // The app's reactions name the outsider.
    const app = await s.as(s.owner)(`/reaction/task/${s.task.id}`);
    expect(app.status).toBe(200);
    expect(JSON.stringify(await app.json())).toContain("Oz");

    const removed = await s.as(s.outsider)(`${s.taskPath}/reactions/heart`, {
      method: "DELETE",
    });
    expect(await removed.json()).toEqual([
      { emoji: "heart", count: 1, reacted: false },
    ]);
    expect(publishedEvents("reaction.removed")).toHaveLength(1);

    const bad = await s.as(s.outsider)(`${s.taskPath}/reactions/poop`, {
      method: "PUT",
    });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toBe("Unsupported reaction");
  });

  it("reacts to public comments but never internal ones", async () => {
    const s = await scene();
    const posted = await s.as(s.outsider)(
      `${s.taskPath}/comments`,
      json("POST", { content: "public" }),
    );
    const { id } = (await posted.json()) as { id: string };
    const ok = await s.as(s.member)(
      `/public-board/${s.token}/comments/${id}/reactions/eyes`,
      { method: "PUT" },
    );
    expect(await ok.json()).toEqual([
      { emoji: "eyes", count: 1, reacted: true },
    ]);
    const internal = await s.as(s.owner)(
      `/comment/${s.task.id}`,
      json("POST", { content: "internal" }),
    );
    const internalId = ((await internal.json()) as { id: string }).id;
    const refused = await s.as(s.member)(
      `/public-board/${s.token}/comments/${internalId}/reactions/eyes`,
      { method: "PUT" },
    );
    expect(refused.status).toBe(404);
    expect(await refused.text()).toBe("Comment not found");
  });

  it("refuses reactions while they are off", async () => {
    const s = await scene({ ...ALL_ON, reactionsEnabled: false });
    for (const method of ["PUT", "DELETE"]) {
      const response = await s.as(s.outsider)(`${s.taskPath}/reactions/heart`, {
        method,
      });
      expect(response.status).toBe(403);
      expect(await response.text()).toBe(
        "Reactions are turned off for this board",
      );
    }
  });
});

describe("public board votes", () => {
  it("votes up, switches, ignores repeats and removes", async () => {
    const s = await scene();
    const vote = (value: 1 | -1) =>
      s.as(s.outsider)(`${s.taskPath}/vote`, json("PUT", { value }));
    expect(await (await vote(1)).json()).toEqual({ up: 1, down: 0, mine: 1 });
    expect(await (await vote(-1)).json()).toEqual({
      up: 0,
      down: 1,
      mine: -1,
    });
    expect(await (await vote(-1)).json()).toEqual({
      up: 0,
      down: 1,
      mine: -1,
    });
    expect(publishedEvents("task.vote_changed").map((e) => e.data)).toEqual([
      expect.objectContaining({ value: 1, up: 1, down: 0 }),
      expect.objectContaining({ value: -1, up: 0, down: 1 }),
    ]);
    await s.as(s.member)(`${s.taskPath}/vote`, json("PUT", { value: 1 }));

    const remove = () =>
      s.as(s.outsider)(`${s.taskPath}/vote`, { method: "DELETE" });
    expect(await (await remove()).json()).toEqual({
      up: 1,
      down: 0,
      mine: null,
    });
    expect(await (await remove()).json()).toEqual({
      up: 1,
      down: 0,
      mine: null,
    });
    expect(publishedEvents("task.vote_changed")).toHaveLength(4);

    // The list and the detail carry the same counts; P12 for the app.
    const page = (await (
      await s.as(null)(`/public-board/${s.token}/tasks`)
    ).json()) as { tasks: Record<string, { counts: Record<string, number> }> };
    expect(page.tasks[s.task.id]?.counts).toMatchObject({
      votesUp: 1,
      votesDown: 0,
    });
    const detail = (await (await s.as(s.member)(s.taskPath)).json()) as {
      votes: unknown;
    };
    expect(detail.votes).toEqual({ up: 1, down: 0, mine: 1 });
    const summary = await s.as(s.owner)(`/publication/task/${s.task.id}/votes`);
    expect(summary.status).toBe(200);
    expect(await summary.json()).toMatchObject({ up: 1, down: 0 });

    const sorted = await s.as(null)(
      `/public-board/${s.token}/tasks?sort=votes`,
    );
    expect(sorted.status).toBe(200);
  });

  it("needs an account and votes turned on", async () => {
    const s = await scene();
    const guest = await s.as(s.guest)(
      `${s.taskPath}/vote`,
      json("PUT", { value: 1 }),
    );
    expect(guest.status).toBe(403);
    expect(await guest.text()).toBe("Sign in with an account to do this");
    const bad = await s.as(s.outsider)(
      `${s.taskPath}/vote`,
      json("PUT", { value: 2 }),
    );
    expect(bad.status).toBe(400);

    const off = await scene({ ...ALL_ON, votesEnabled: false });
    for (const init of [json("PUT", { value: 1 }), { method: "DELETE" }]) {
      const response = await off.as(off.outsider)(`${off.taskPath}/vote`, init);
      expect(response.status).toBe(403);
    }
    const detail = (await (await off.as(null)(off.taskPath)).json()) as Record<
      string,
      unknown
    >;
    expect(detail).not.toHaveProperty("votes");
    const page = (await (
      await off.as(null)(`/public-board/${off.token}/tasks`)
    ).json()) as { tasks: Record<string, { counts: Record<string, number> }> };
    expect(page.tasks[off.task.id]?.counts).not.toHaveProperty("votesUp");
  });
});
