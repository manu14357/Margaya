import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { json } from "./helpers/cycles";
import { resetTestDatabase } from "./helpers/database";
import {
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

type ReportJson = {
  id: string;
  name: string;
  visibility: "private" | "workspace";
  isOwner: boolean;
  canDelete: boolean;
  config: { xAxis: string; scope?: { projectIds: string[] } };
  droppedProjectCount: number;
};

async function reportScene() {
  const ana = await createWorkspaceMember({ role: "member" });
  const workspaceId = ana.workspace.id;
  const ben = await addWorkspaceMember(workspaceId, "member");
  const admin = await addWorkspaceMember(workspaceId, "admin");
  const viewer = await addWorkspaceMember(workspaceId, "viewer");
  const outsider = await createWorkspaceMember({ role: "owner" });
  const { project } = await createProjectFixture({ workspaceId, slug: "rep" });
  const second = await createProjectFixture({ workspaceId, slug: "rp2" });
  const foreign = await createProjectFixture({
    workspaceId: outsider.workspace.id,
    slug: "frn",
  });
  const { app } = createApp();

  const as = (
    user: { id: string },
    method: string,
    path: string,
    body?: unknown,
  ) => {
    mockAuthenticatedSession(user as never);
    return app.request(
      `/api${path}`,
      body === undefined ? { method } : json(method, body),
    );
  };
  const save = async (
    user: { id: string },
    body: Record<string, unknown>,
  ): Promise<ReportJson> => {
    const response = await as(user, "POST", "/analytics-report", {
      workspaceId,
      name: "Report",
      config: { xAxis: "priority" },
      ...body,
    });
    expect(response.status, await response.clone().text()).toBe(200);
    return (await response.json()) as ReportJson;
  };
  const list = async (user: { id: string }) => {
    const response = await as(
      user,
      "GET",
      `/analytics-report?workspaceId=${workspaceId}`,
    );
    expect(response.status).toBe(200);
    return (await response.json()) as ReportJson[];
  };

  return {
    ana: ana.user,
    ben,
    admin,
    viewer,
    outsider,
    workspaceId,
    project,
    second,
    foreign,
    as,
    save,
    list,
  };
}

describe("API integration: saved analytics reports", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("keeps private reports to their owner and shares workspace ones", async () => {
    const s = await reportScene();
    const mine = await s.save(s.ana, { name: "Mine" });
    const shared = await s.save(s.ana, {
      name: "Shared",
      visibility: "workspace",
      config: {
        xAxis: "assignee",
        segment: "priority",
        scope: { projectIds: [s.project.id] },
        sortByValue: true,
      },
    });
    expect(mine).toMatchObject({ visibility: "private", isOwner: true });

    expect((await s.list(s.ana)).map((r) => r.name)).toEqual([
      "Mine",
      "Shared",
    ]);
    expect((await s.list(s.ben)).map((r) => r.name)).toEqual(["Shared"]);
    // Admins included: nobody else sees a private report.
    expect((await s.list(s.admin)).map((r) => r.name)).toEqual(["Shared"]);
    expect(
      (await s.as(s.admin, "GET", `/analytics-report/${mine.id}`)).status,
    ).toBe(404);
    expect(
      (await s.as(s.admin, "DELETE", `/analytics-report/${mine.id}`)).status,
    ).toBe(404);

    const read = await s.as(s.ben, "GET", `/analytics-report/${shared.id}`);
    expect(await read.json()).toMatchObject({
      isOwner: false,
      canDelete: false,
      config: {
        xAxis: "assignee",
        segment: "priority",
        sortByValue: true,
        scope: { projectIds: [s.project.id] },
      },
    });
  });

  it("lets only the owner edit, and the owner or an admin delete shared reports", async () => {
    const s = await reportScene();
    const shared = await s.save(s.ana, { visibility: "workspace" });
    const path = `/analytics-report/${shared.id}`;

    expect((await s.as(s.ben, "PATCH", path, { name: "X" })).status).toBe(403);
    expect((await s.as(s.admin, "PATCH", path, { name: "X" })).status).toBe(
      403,
    );
    expect((await s.as(s.ben, "DELETE", path)).status).toBe(403);

    const renamed = await s.as(s.ana, "PATCH", path, {
      name: "Renamed",
      visibility: "private",
    });
    expect(await renamed.json()).toMatchObject({
      name: "Renamed",
      visibility: "private",
    });
    expect((await s.list(s.ben)).map((r) => r.id)).toEqual([]);

    await s.as(s.ana, "PATCH", path, { visibility: "workspace" });
    const adminView = await s.as(s.admin, "GET", path);
    expect(await adminView.json()).toMatchObject({ canDelete: true });
    expect((await s.as(s.admin, "DELETE", path)).status).toBe(200);
    expect(await s.list(s.ana)).toEqual([]);
  });

  it("needs analytics access in the report's workspace", async () => {
    const s = await reportScene();
    const shared = await s.save(s.ana, { visibility: "workspace" });

    // Viewers have no analytics:read by default.
    expect(
      (
        await s.as(
          s.viewer,
          "GET",
          `/analytics-report?workspaceId=${s.workspaceId}`,
        )
      ).status,
    ).toBe(403);
    expect(
      (await s.as(s.viewer, "GET", `/analytics-report/${shared.id}`)).status,
    ).toBe(403);
    expect(
      (
        await s.as(s.viewer, "POST", "/analytics-report", {
          workspaceId: s.workspaceId,
          name: "V",
          config: { xAxis: "priority" },
        })
      ).status,
    ).toBe(403);

    expect(
      (await s.as(s.outsider.user, "GET", `/analytics-report/${shared.id}`))
        .status,
    ).toBe(403);
    expect(
      (
        await s.as(s.outsider.user, "POST", "/analytics-report", {
          workspaceId: s.workspaceId,
          name: "O",
          config: { xAxis: "priority" },
        })
      ).status,
    ).toBe(403);
  });

  it("checks the scope against the workspace on save and on read", async () => {
    const s = await reportScene();
    const foreign = await s.as(s.ana, "POST", "/analytics-report", {
      workspaceId: s.workspaceId,
      name: "Foreign",
      config: {
        xAxis: "priority",
        scope: { projectIds: [s.foreign.project.id] },
      },
    });
    expect(foreign.status).toBe(404);

    const invalid = await s.as(s.ana, "POST", "/analytics-report", {
      workspaceId: s.workspaceId,
      name: "Bad",
      config: { xAxis: "nope" },
    });
    expect(invalid.status).toBe(400);

    const report = await s.save(s.ana, {
      config: {
        xAxis: "priority",
        scope: { projectIds: [s.project.id, s.second.project.id] },
      },
    });
    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.projectTable.id, s.second.project.id));

    const [read] = await s.list(s.ana);
    expect(read?.id).toBe(report.id);
    expect(read?.config.scope).toEqual({ projectIds: [s.project.id] });
    expect(read?.droppedProjectCount).toBe(1);
  });
});
