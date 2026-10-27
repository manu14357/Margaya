import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  FLOW_ALERTS_LEASE,
  runFlowAlerts,
} from "../../apps/api/src/delivery/flow-alert-job";
import { createApp } from "../../apps/api/src/index";
import { shiftDate, todayUtc } from "../../apps/api/src/utils/calendar-date";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

// Flow anomaly alerts (A4): opt-in, once per metric and week, to the lead.

const noon = (offset: number) =>
  new Date(`${shiftDate(todayUtc(), offset)}T12:00:00.000Z`);

async function scene() {
  const { user: admin, workspace } = await createWorkspaceMember({
    role: "admin",
  });
  const lead = await addWorkspaceMember(workspace.id, "member");

  /** A project that finished two tasks a day for eight weeks, then none. */
  const stalledProject = async (
    slug: string,
    { enabled = true, withLead = true } = {},
  ) => {
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
      slug,
      name: `Project ${slug}`,
    });
    await db
      .update(schema.projectTable)
      .set({ createdAt: noon(-100), leadUserId: withLead ? lead.id : null })
      .where(eq(schema.projectTable.id, project.id));
    await db.insert(schema.projectAutomationTable).values({
      projectId: project.id,
      flowAlertsEnabled: enabled,
    });
    const rows = [];
    for (let offset = 8; offset <= 63; offset++) {
      for (const n of [0, 1]) {
        rows.push({
          projectId: project.id,
          title: `Done ${offset}-${n}`,
          number: offset * 2 + n,
          status: "done",
          completedAt: noon(-offset),
          createdAt: noon(-offset - 3),
        });
      }
    }
    await db.insert(schema.taskTable).values(rows);
    return project;
  };

  return { admin, lead, workspace, stalledProject };
}

const leadNotifications = (userId: string) =>
  db
    .select()
    .from(schema.notificationTable)
    .where(
      and(
        eq(schema.notificationTable.userId, userId),
        eq(schema.notificationTable.type, "flow_anomaly"),
      ),
    );

describe("API integration: flow anomaly alerts", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("notifies the lead once per metric and week", async () => {
    const s = await scene();
    const project = await s.stalledProject("stall");

    expect(await runFlowAlerts()).toEqual({
      degraded: false,
      projects: 1,
      alerts: 1,
    });
    const [notification, ...rest] = await leadNotifications(s.lead.id);
    expect(rest).toEqual([]);
    expect(notification).toMatchObject({
      resourceType: "workspace",
      resourceId: s.workspace.id,
      workspaceId: s.workspace.id,
      eventData: expect.objectContaining({
        projectId: project.id,
        metric: "throughput",
        direction: "low",
        value: 0,
        baselineMedian: 14,
        windowEnd: shiftDate(todayUtc(), -1),
      }),
    });
    const [alert] = await db
      .select()
      .from(schema.flowAlertTable)
      .where(eq(schema.flowAlertTable.projectId, project.id));
    expect(alert).toMatchObject({
      metric: "throughput",
      notifiedUserId: s.lead.id,
    });

    // Already checked today: nothing to do.
    expect((await runFlowAlerts()).projects).toBe(0);

    // Checked again in the same week: the same anomaly stays quiet.
    await db
      .update(schema.projectAutomationTable)
      .set({ flowAlertsCheckedOn: null })
      .where(eq(schema.projectAutomationTable.projectId, project.id));
    expect(await runFlowAlerts()).toMatchObject({ projects: 1, alerts: 0 });
    expect(await leadNotifications(s.lead.id)).toHaveLength(1);
  });

  it("stays off unless opted in, and needs a lead to notify", async () => {
    const s = await scene();
    await s.stalledProject("off", { enabled: false });
    const leadless = await s.stalledProject("nolead", { withLead: false });

    expect(await runFlowAlerts()).toMatchObject({ projects: 1, alerts: 1 });
    expect(await leadNotifications(s.lead.id)).toEqual([]);
    const [alert] = await db
      .select()
      .from(schema.flowAlertTable)
      .where(eq(schema.flowAlertTable.projectId, leadless.id));
    expect(alert?.notifiedUserId).toBeNull();
  });

  it("does nothing while another instance holds the lease", async () => {
    const s = await scene();
    await s.stalledProject("lease");
    await db.insert(schema.jobLeaseTable).values({
      name: FLOW_ALERTS_LEASE,
      owner: "another-instance",
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(await runFlowAlerts()).toEqual({
      degraded: false,
      projects: 0,
      alerts: 0,
    });
    expect(await leadNotifications(s.lead.id)).toEqual([]);
  });

  it("is switched with project:update", async () => {
    const s = await scene();
    const { project } = await createProjectFixture({
      workspaceId: s.workspace.id,
      slug: "toggle",
    });
    const { app } = createApp();
    const patch = () =>
      app.request(`/api/project-automation/${project.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ flowAlerts: { enabled: true } }),
      });

    mockAuthenticatedSession(s.lead);
    expect((await patch()).status).toBe(403);

    mockAuthenticatedSession(s.admin);
    const response = await patch();
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toMatchObject({
      flowAlerts: { enabled: true, lastCheckedOn: null, lastAlertAt: null },
      cycleRollover: { enabled: false },
    });
    const read = await app.request(`/api/project-automation/${project.id}`);
    expect(await read.json()).toMatchObject({ flowAlerts: { enabled: true } });
  });
});
