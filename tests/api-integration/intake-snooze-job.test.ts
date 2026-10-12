import { eq, inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  INTAKE_SNOOZE_LEASE,
  wakeSnoozedIntakeItems,
} from "../../apps/api/src/intake/snooze-job";
import { resetTestDatabase } from "./helpers/database";
import { createProjectFixture } from "./helpers/fixtures";
import {
  clearPublishedEvents,
  intakeRow,
  intakeScene,
  publishedEvents,
  recordEvents,
  setIntakeEnabled,
  settle,
  settledActivity,
} from "./helpers/intake";

recordEvents("intake.item_updated");

type Scene = Awaited<ReturnType<typeof intakeScene>>;

async function snooze(itemIds: string[], until: Date, triagedBy: string) {
  await db
    .update(schema.intakeItemTable)
    .set({ status: "snoozed", snoozedUntil: until, triagedBy })
    .where(inArray(schema.intakeItemTable.id, itemIds));
}

/** `count` requests of a project, inserted directly for speed. */
async function seedRequests(scene: Scene, projectId: string, count: number) {
  const [triage] = await db
    .insert(schema.columnTable)
    .values({
      projectId,
      name: "Triage",
      slug: "triage",
      group: "triage",
      position: 10,
    })
    .onConflictDoNothing()
    .returning();
  const tasks = await db
    .insert(schema.taskTable)
    .values(
      Array.from({ length: count }, (_, index) => ({
        projectId,
        title: `Seeded ${index}`,
        number: 5000 + index,
        status: "triage",
        columnId: triage?.id ?? null,
      })),
    )
    .returning({ id: schema.taskTable.id });
  const items = await db
    .insert(schema.intakeItemTable)
    .values(
      tasks.map((task) => ({
        projectId,
        taskId: task.id,
        submittedBy: scene.viewer.id,
      })),
    )
    .returning({ id: schema.intakeItemTable.id });
  return items.map((item) => item.id);
}

describe("API integration: intake snooze wake-up job", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    clearPublishedEvents();
  });

  it("wakes due snoozes across projects, once, keeping the snoozer", async () => {
    const scene = await intakeScene();
    const { project: second } = await createProjectFixture({
      workspaceId: scene.workspace.id,
      slug: "ops",
    });
    await setIntakeEnabled(second.id, false);
    const due = await scene.submit(scene.viewer);
    const future = await scene.submit(scene.viewer);
    const [otherDue] = await seedRequests(scene, second.id, 1);
    await snooze(
      [due.id, otherDue ?? ""],
      new Date(Date.now() - 60_000),
      scene.member.id,
    );
    await snooze(
      [future.id],
      new Date(Date.now() + 86_400_000),
      scene.member.id,
    );

    expect(await wakeSnoozedIntakeItems()).toEqual({
      woken: 2,
      degraded: false,
    });
    for (const id of [due.id, otherDue ?? ""]) {
      expect(await intakeRow(id)).toMatchObject({
        status: "pending",
        snoozedUntil: null,
        triagedBy: scene.member.id,
      });
    }
    expect(await intakeRow(future.id)).toMatchObject({ status: "snoozed" });

    const [ended] = await settledActivity(due.taskId, "intake_snooze_ended");
    expect(ended).toMatchObject({ userId: null, eventData: {} });
    await settle();
    const events = publishedEvents("intake.item_updated");
    expect(events.map((e) => e.data.intakeItemId).sort()).toEqual(
      [due.id, otherDue].sort(),
    );
    expect(events[0]?.data).toMatchObject({
      action: "snooze_ended",
      userId: null,
      previousStatus: "snoozed",
      status: "pending",
    });

    // Nothing is left to wake.
    expect(await wakeSnoozedIntakeItems()).toEqual({
      woken: 0,
      degraded: false,
    });
  });

  it("wakes more than one batch in a run", async () => {
    const scene = await intakeScene();
    const ids = await seedRequests(scene, scene.project.id, 520);
    await snooze(ids, new Date(Date.now() - 60_000), scene.member.id);
    const result = await wakeSnoozedIntakeItems();
    expect(result).toEqual({ woken: 520, degraded: false });
    const rows = await db
      .select({ status: schema.intakeItemTable.status })
      .from(schema.intakeItemTable)
      .where(eq(schema.intakeItemTable.projectId, scene.project.id));
    expect(rows.every((row) => row.status === "pending")).toBe(true);
  });

  it("does nothing while another instance holds the lease", async () => {
    const scene = await intakeScene();
    const item = await scene.submit(scene.viewer);
    await snooze([item.id], new Date(Date.now() - 60_000), scene.member.id);
    await db.insert(schema.jobLeaseTable).values({
      name: INTAKE_SNOOZE_LEASE,
      owner: "another-instance",
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(await wakeSnoozedIntakeItems()).toEqual({
      woken: 0,
      degraded: false,
    });
    expect((await intakeRow(item.id))?.status).toBe("snoozed");
  });
});
