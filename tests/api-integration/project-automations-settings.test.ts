import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { previewProjectAutomation } from "../../apps/api/src/project-automation/controllers/preview-automation";
import { automationScene, monthsAgo } from "./helpers/automations";
import { resetTestDatabase } from "./helpers/database";
import {
  clearPublishedEvents,
  publishedEvents,
  recordEvents,
} from "./helpers/intake";

recordEvents("project.automations_updated");

beforeEach(async () => {
  await resetTestDatabase();
  clearPublishedEvents();
});

type AutomationsJson = {
  projectId: string;
  autoArchive: {
    enabled: boolean;
    months: number;
    lastArchivedAt: string | null;
    lastArchivedCount: number;
  };
  autoClose: {
    enabled: boolean;
    months: number;
    columnId: string | null;
    column: { id: string; slug: string; group: string } | null;
    state: string;
    pausedReason: string | null;
    lastClosedAt: string | null;
    lastClosedCount: number;
  };
  lastCheckedAt: string | null;
  updatedAt: string | null;
  updatedBy: { id: string; name: string } | null;
};

describe("scheduled automation settings", () => {
  it("reads both rules off before anything is set", async () => {
    const s = await automationScene();
    const read = await s.ok<AutomationsJson>(
      s.vic,
      "GET",
      `/project-automation/${s.web.project.id}`,
    );
    expect(read).toEqual({
      projectId: s.web.project.id,
      autoArchive: {
        enabled: false,
        months: 3,
        lastArchivedAt: null,
        lastArchivedCount: 0,
      },
      autoClose: {
        enabled: false,
        months: 3,
        columnId: null,
        column: null,
        state: "off",
        pausedReason: null,
        lastClosedAt: null,
        lastClosedCount: 0,
      },
      cycleRollover: {
        enabled: false,
        since: null,
        lastRolledOverAt: null,
        lastRolledOverCount: 0,
      },
      flowAlerts: { enabled: false, lastCheckedOn: null, lastAlertAt: null },
      lastCheckedAt: null,
      updatedAt: null,
      updatedBy: null,
    });
  });

  it("turns rules on and off, keeping months and column", async () => {
    const s = await automationScene();
    const path = `/project-automation/${s.web.project.id}`;
    const archiveOn = await s.ok<AutomationsJson>(s.ada, "PATCH", path, {
      autoArchive: { enabled: true, months: 6 },
    });
    expect(archiveOn.autoArchive).toMatchObject({ enabled: true, months: 6 });
    expect(archiveOn.updatedBy).toEqual({ id: s.ada.id, name: "Ada" });
    expect(publishedEvents()[0]?.data).toMatchObject({
      projectId: s.web.project.id,
      workspaceId: s.workspaceId,
      userId: s.ada.id,
      changed: ["autoArchive.enabled", "autoArchive.months"],
    });

    const closeOn = await s.ok<AutomationsJson>(s.ada, "PATCH", path, {
      autoClose: { enabled: true, columnId: s.wontDo.id },
    });
    expect(closeOn.autoClose).toMatchObject({
      enabled: true,
      months: 3,
      columnId: s.wontDo.id,
      column: { id: s.wontDo.id, slug: "wont-do", group: "cancelled" },
      state: "active",
      pausedReason: null,
    });

    const off = await s.ok<AutomationsJson>(s.ada, "PATCH", path, {
      autoArchive: { enabled: false },
      autoClose: { enabled: false },
    });
    expect(off.autoArchive).toMatchObject({ enabled: false, months: 6 });
    expect(off.autoClose).toMatchObject({
      enabled: false,
      columnId: s.wontDo.id,
      state: "off",
    });

    // Back on: the stored column is still valid.
    const again = await s.ok<AutomationsJson>(s.ada, "PATCH", path, {
      autoClose: { enabled: true },
    });
    expect(again.autoClose.state).toBe("active");

    clearPublishedEvents();
    await s.ok(s.ada, "PATCH", path, { autoClose: { enabled: true } });
    expect(publishedEvents()).toEqual([]);
  });

  it("refuses bad columns, months and callers", async () => {
    const s = await automationScene();
    const path = `/project-automation/${s.web.project.id}`;
    const [triage] = await db
      .insert(schema.columnTable)
      .values({
        projectId: s.web.project.id,
        name: "Triage",
        slug: "triage",
        group: "triage",
        position: 99,
      })
      .returning();
    const [otherCancelled] = await db
      .insert(schema.columnTable)
      .values({
        projectId: s.api.project.id,
        name: "Dropped",
        slug: "dropped",
        group: "cancelled",
      })
      .returning();
    const refuse = async (body: unknown, status: number, text?: string) => {
      const response = await s.as(s.ada)("PATCH", path, body);
      const message = await response.text();
      expect(response.status, message).toBe(status);
      if (text) expect(message).toBe(text);
    };
    const cancelled = "Choose a column in the Cancelled group of this project";

    await refuse({ autoClose: { enabled: true } }, 400, cancelled);
    for (const columnId of [
      s.web.columns.done.id,
      otherCancelled?.id,
      triage?.id,
    ]) {
      await refuse({ autoClose: { enabled: true, columnId } }, 400, cancelled);
    }
    await refuse(
      { autoClose: { enabled: true, columnId: null } },
      400,
      cancelled,
    );
    await refuse({ autoArchive: { months: 0 } }, 400);
    await refuse({ autoArchive: { months: 13 } }, 400);
    await refuse({ autoArchive: { months: 2.5 } }, 400);
    await refuse({}, 400, "Provide at least one setting to change");
    await refuse(
      { autoArchive: {} },
      400,
      "Provide at least one setting to change",
    );
    await refuse({ extra: true }, 400);

    const member = await s.as(s.mia)("PATCH", path, {
      autoArchive: { enabled: true },
    });
    expect(member.status).toBe(403);
    await s.ok(s.owner, "PATCH", path, { autoArchive: { enabled: true } });
  });

  it("pauses auto-close when its column goes away or leaves the Cancelled group", async () => {
    const s = await automationScene();
    const path = `/project-automation/${s.web.project.id}`;
    await s.ok(s.ada, "PATCH", path, {
      autoClose: { enabled: true, columnId: s.wontDo.id },
    });

    await db
      .update(schema.columnTable)
      .set({ group: "started" })
      .where(eq(schema.columnTable.id, s.wontDo.id));
    const moved = await s.ok<AutomationsJson>(s.ada, "GET", path);
    expect(moved.autoClose).toMatchObject({
      state: "paused",
      pausedReason: "column_not_cancelled",
    });

    // Other settings still save while auto-close is paused.
    await s.ok(s.ada, "PATCH", path, { autoArchive: { enabled: true } });

    await db
      .delete(schema.columnTable)
      .where(eq(schema.columnTable.id, s.wontDo.id));
    const gone = await s.ok<AutomationsJson>(s.ada, "GET", path);
    expect(gone.autoClose).toMatchObject({
      enabled: true,
      columnId: null,
      column: null,
      state: "paused",
      pausedReason: "no_column",
    });
  });
});

describe("scheduled automation preview", () => {
  it("counts what the job would take, and caps the count", async () => {
    const s = await automationScene();
    const now = new Date();
    await s.createTask({ status: "done" });
    await s.createTask({ status: "wont-do" });
    await s.createTask({ status: "done", updatedAt: monthsAgo(now, 2) });
    await s.createTask({ status: "to-do" });
    await s.createTask({ status: "in-progress" });
    await s.createTask({ status: "planned" });

    const preview = (rule: string, months: number) =>
      s.ok<{ rule: string; months: number; count: number; capped: boolean }>(
        s.vic,
        "GET",
        `/project-automation/${s.web.project.id}/preview?rule=${rule}&months=${months}`,
      );
    expect(await preview("archive", 3)).toEqual({
      rule: "archive",
      months: 3,
      count: 2,
      capped: false,
    });
    expect((await preview("archive", 1)).count).toBe(3);
    expect((await preview("close", 3)).count).toBe(3);

    const capped = await previewProjectAutomation({
      projectId: s.web.project.id,
      rule: "close",
      months: 3,
      cap: 2,
    });
    expect(capped).toEqual({
      rule: "close",
      months: 3,
      count: 2,
      capped: true,
    });

    // The job takes exactly what the preview counted.
    await s.configure({
      autoArchiveEnabled: true,
      autoCloseEnabled: true,
      autoCloseColumnId: s.wontDo.id,
    });
    expect(await s.run(now)).toMatchObject({ archived: 2, closed: 3 });

    const invalid = await s.as(s.vic)(
      "GET",
      `/project-automation/${s.web.project.id}/preview?rule=delete&months=3`,
    );
    expect(invalid.status).toBe(400);
  });
});
