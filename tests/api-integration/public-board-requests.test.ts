import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { setPublicBoardInstanceState } from "../../apps/api/src/public-board/instance-state";
import { resetTestDatabase } from "./helpers/database";
import {
  clearPublishedEvents,
  publishedEvents,
  recordEvents,
  setIntakeEnabled,
} from "./helpers/intake";
import {
  ALL_ON,
  boardScene,
  json,
  resetPublicBoardState,
} from "./helpers/public-board";

type PublicRequest = {
  id: string;
  title: string;
  status: string;
  note: string | null;
  boardTaskNumber: number | null;
  canWithdraw: boolean;
};

beforeEach(async () => {
  await resetTestDatabase();
  resetPublicBoardState();
  recordEvents("intake.item_created", "task.created", "intake.item_deleted");
  clearPublishedEvents();
});
afterAll(() => setPublicBoardInstanceState(null));

async function scene(settings: Record<string, unknown> = ALL_ON) {
  const base = await boardScene();
  const token = await base.publish(settings);
  const submit = (
    user: Parameters<typeof base.as>[0],
    body: Record<string, unknown> = { title: "Please add dark mode" },
  ) => base.as(user)(`/public-board/${token}/requests`, json("POST", body));
  const mine = async (user: Parameters<typeof base.as>[0]) => {
    const response = await base.as(user)(
      `/public-board/${token}/requests/mine`,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    return (await response.json()) as {
      items: PublicRequest[];
      nextCursor: string | null;
    };
  };
  return { ...base, token, submit, mine };
}

describe("public board requests", () => {
  it("refuses requests when off, without intake, for guests and visitors", async () => {
    const off = await scene({ ...ALL_ON, requestsEnabled: false });
    const refused = await off.submit(off.outsider);
    expect(refused.status).toBe(403);
    expect(await refused.text()).toBe("Requests are turned off for this board");

    const s = await scene();
    await setIntakeEnabled(s.project.id, false);
    expect((await s.submit(s.outsider)).status).toBe(403);
    await setIntakeEnabled(s.project.id, true);
    expect((await s.submit(s.guest)).status).toBe(403);
    expect((await s.submit(null)).status).toBe(401);
  });

  it("files an intake request that stays off the board", async () => {
    const s = await scene();
    const response = await s.submit(s.outsider, {
      title: "  **Dark**  <i>mode</i> ",
      description: "Please <script>x</script>![img](https://i.test/a.png)",
    });
    expect(response.status, await response.clone().text()).toBe(201);
    const request = (await response.json()) as PublicRequest;
    expect(request).toMatchObject({
      title: "Dark mode",
      status: "in_review",
      note: null,
      boardTaskNumber: null,
      canWithdraw: true,
    });
    const [item] = await db
      .select()
      .from(schema.intakeItemTable)
      .where(eq(schema.intakeItemTable.id, request.id));
    expect(item).toMatchObject({
      source: "public_board",
      submittedBy: s.outsider.id,
    });
    const [task] = await db
      .select()
      .from(schema.taskTable)
      .where(eq(schema.taskTable.id, item?.taskId ?? ""));
    expect(task).toMatchObject({
      priority: "no-priority",
      description: "Please x[img](https://i.test/a.png)",
    });
    expect(publishedEvents("intake.item_created")[0]?.data).toMatchObject({
      source: "public_board",
    });
    expect(publishedEvents("task.created")).toHaveLength(0);
    const page = (await (
      await s.as(null)(`/public-board/${s.token}/tasks`)
    ).json()) as { totalCount: number };
    expect(page.totalCount).toBe(0);

    expect((await s.submit(s.outsider, { title: "<b></b>" })).status).toBe(400);
    expect(
      (await s.submit(s.outsider, { title: "t".repeat(256) })).status,
    ).toBe(400);
  });

  it("lists my requests with mapped statuses", async () => {
    const s = await scene();
    const accepted = (await (
      await s.submit(s.outsider, { title: "Accept me" })
    ).json()) as PublicRequest;
    const declined = (await (
      await s.submit(s.outsider, { title: "Decline me" })
    ).json()) as PublicRequest;
    const duplicate = (await (
      await s.submit(s.outsider, { title: "Duplicate me" })
    ).json()) as PublicRequest;
    await s.submit(s.member, { title: "Not mine" });
    const hidden = await s.createTask("Hidden target", {
      archivedAt: new Date(),
    });

    const owner = s.as(s.owner);
    expect(
      (
        await owner(
          `/intake/item/${accepted.id}/accept`,
          json("POST", { status: "to-do" }),
        )
      ).status,
    ).toBe(200);
    await owner(
      `/intake/item/${declined.id}/decline`,
      json("POST", { note: "Out of scope" }),
    );
    const visible = await s.createTask("Visible target");
    const markDuplicate = await owner(
      `/intake/item/${duplicate.id}/duplicate`,
      json("POST", { duplicateOfTaskId: visible.id, note: "Already planned" }),
    );
    expect(markDuplicate.status, await markDuplicate.clone().text()).toBe(200);
    void hidden;

    const { items, nextCursor } = await s.mine(s.outsider);
    expect(nextCursor).toBeNull();
    const byTitle = new Map(items.map((item) => [item.title, item]));
    expect(items.map((item) => item.title)).toEqual([
      "Duplicate me",
      "Decline me",
      "Accept me",
    ]);
    const [acceptedTask] = await db
      .select({ number: schema.taskTable.number })
      .from(schema.intakeItemTable)
      .innerJoin(
        schema.taskTable,
        eq(schema.taskTable.id, schema.intakeItemTable.taskId),
      )
      .where(eq(schema.intakeItemTable.id, accepted.id));
    expect(byTitle.get("Accept me")).toMatchObject({
      status: "accepted",
      boardTaskNumber: acceptedTask?.number,
      canWithdraw: false,
    });
    expect(byTitle.get("Decline me")).toMatchObject({
      status: "declined",
      note: "Out of scope",
      boardTaskNumber: null,
    });
    expect(byTitle.get("Duplicate me")).toMatchObject({
      status: "duplicate",
      note: "Already planned",
      boardTaskNumber: visible.number,
    });
  });

  it("withdraws my open request only", async () => {
    const s = await scene();
    const open = (await (await s.submit(s.outsider)).json()) as PublicRequest;
    const others = (await (await s.submit(s.member)).json()) as PublicRequest;
    const notMine = await s.as(s.outsider)(
      `/public-board/${s.token}/requests/${others.id}`,
      { method: "DELETE" },
    );
    expect(notMine.status).toBe(404);
    expect(await notMine.text()).toBe("Request not found");

    const withdrawn = await s.as(s.outsider)(
      `/public-board/${s.token}/requests/${open.id}`,
      { method: "DELETE" },
    );
    expect(withdrawn.status, await withdrawn.clone().text()).toBe(200);
    expect(await withdrawn.json()).toEqual({ id: open.id });
    expect(publishedEvents("intake.item_deleted")).toHaveLength(1);
    expect(
      await db
        .select()
        .from(schema.intakeItemTable)
        .where(eq(schema.intakeItemTable.id, open.id)),
    ).toHaveLength(0);

    const accepted = (await (
      await s.submit(s.outsider)
    ).json()) as PublicRequest;
    await s.as(s.owner)(
      `/intake/item/${accepted.id}/accept`,
      json("POST", { status: "to-do" }),
    );
    const late = await s.as(s.outsider)(
      `/public-board/${s.token}/requests/${accepted.id}`,
      { method: "DELETE" },
    );
    expect(late.status).toBe(409);
    expect(await late.text()).toBe("This request can't be withdrawn anymore");
  });

  it("limits each account to 5 requests an hour", async () => {
    const s = await scene();
    for (let i = 0; i < 5; i += 1) {
      expect((await s.submit(s.outsider, { title: `Idea ${i}` })).status).toBe(
        201,
      );
    }
    const limited = await s.submit(s.outsider, { title: "Idea 6" });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBeTruthy();
  });
});
