import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { subscribeToEvent } from "../../apps/api/src/events";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

const featureEvents: Array<Record<string, unknown>> = [];
await subscribeToEvent<Record<string, unknown>>(
  "project.features_updated",
  async (data) => {
    featureEvents.push(data);
  },
);

const DEFAULT_FLAGS = {
  cyclesEnabled: true,
  modulesEnabled: true,
  viewsEnabled: true,
  pagesEnabled: true,
  whiteboardsEnabled: true,
  intakeEnabled: false,
  estimatesEnabled: false,
  timeTrackingEnabled: true,
};

function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function ownerContext() {
  const owner = await createWorkspaceMember({ role: "owner" });
  const fixture = await createProjectFixture({
    workspaceId: owner.workspace.id,
    slug: "feat",
  });
  mockAuthenticatedSession(owner.user);
  const { app } = createApp();
  return { ...owner, ...fixture, app };
}

describe("API integration: project features", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    featureEvents.length = 0;
  });

  it("creates projects with the default flags and returns them everywhere", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(owner.user);
    const { app } = createApp();

    const created = await app.request(
      "/api/project",
      json("POST", {
        name: "Flags",
        workspaceId: owner.workspace.id,
        icon: "Layout",
        slug: "flg",
      }),
    );
    const project = (await created.json()) as { id: string };
    expect(project).toMatchObject(DEFAULT_FLAGS);

    const detail = await app.request(`/api/project/${project.id}`);
    expect(await detail.json()).toMatchObject(DEFAULT_FLAGS);

    const list = await app.request(
      `/api/project?workspaceId=${owner.workspace.id}`,
    );
    const [item] = (await list.json()) as unknown[];
    expect(item).toMatchObject(DEFAULT_FLAGS);
  });

  it("changes only the flags sent and reports what changed", async () => {
    const { app, project, workspace, user } = await ownerContext();

    const response = await app.request(
      `/api/project/${project.id}/features`,
      json("PATCH", { cyclesEnabled: false, intakeEnabled: true }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ...DEFAULT_FLAGS,
      cyclesEnabled: false,
      intakeEnabled: true,
    });
    expect(featureEvents).toEqual([
      expect.objectContaining({
        projectId: project.id,
        workspaceId: workspace.id,
        userId: user.id,
        enabled: ["intake"],
        disabled: ["cycles"],
      }),
    ]);
  });

  it("answers a no-op change without publishing", async () => {
    const { app, project } = await ownerContext();

    const response = await app.request(
      `/api/project/${project.id}/features`,
      json("PATCH", { cyclesEnabled: true }),
    );

    expect(response.status).toBe(200);
    expect(featureEvents).toHaveLength(0);
  });

  it("rejects unknown keys and empty bodies", async () => {
    const { app, project } = await ownerContext();

    const unknown = await app.request(
      `/api/project/${project.id}/features`,
      json("PATCH", { cyclesEnabled: true, rocketsEnabled: true }),
    );
    const empty = await app.request(
      `/api/project/${project.id}/features`,
      json("PATCH", {}),
    );

    expect(unknown.status).toBe(400);
    expect(empty.status).toBe(400);
    expect(await empty.text()).toContain(
      "Provide at least one feature to change",
    );
  });

  it("requires project:update", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    const viewer = await addWorkspaceMember(owner.workspace.id, "viewer");
    const member = await addWorkspaceMember(owner.workspace.id, "member");
    const admin = await addWorkspaceMember(owner.workspace.id, "admin");
    const { app } = createApp();
    const patch = () =>
      app.request(
        `/api/project/${project.id}/features`,
        json("PATCH", { pagesEnabled: false }),
      );

    mockAuthenticatedSession(viewer);
    expect((await patch()).status).toBe(403);
    mockAuthenticatedSession(member);
    expect((await patch()).status).toBe(403);
    mockAuthenticatedSession(admin);
    expect((await patch()).status).toBe(200);
  });

  it("keeps flags when the project is replaced through PUT", async () => {
    const { app, project } = await ownerContext();
    await app.request(
      `/api/project/${project.id}/features`,
      json("PATCH", { viewsEnabled: false }),
    );

    const response = await app.request(
      `/api/project/${project.id}`,
      json("PUT", {
        name: "Renamed",
        icon: "Layout",
        slug: "feat",
        description: "",
        isPublic: false,
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      name: "Renamed",
      viewsEnabled: false,
    });
  });

  it("gates every time-entry route on time tracking", async () => {
    const { app, project } = await ownerContext();
    const [task] = await db
      .insert(schema.taskTable)
      .values({ projectId: project.id, title: "Timed", number: 1 })
      .returning();

    const created = await app.request(
      "/api/time-entry",
      json("POST", { taskId: task.id, startTime: "2026-01-01T09:00:00Z" }),
    );
    expect(created.status).toBe(200);
    const entry = (await created.json()) as { id: string };

    const calls = () => [
      app.request(`/api/time-entry/task/${task.id}`),
      app.request(`/api/time-entry/${entry.id}`),
      app.request(
        "/api/time-entry",
        json("POST", { taskId: task.id, startTime: "2026-01-02T09:00:00Z" }),
      ),
      app.request(
        `/api/time-entry/${entry.id}`,
        json("PUT", {
          startTime: "2026-01-01T09:00:00Z",
          endTime: "2026-01-01T10:00:00Z",
        }),
      ),
    ];

    await app.request(
      `/api/project/${project.id}/features`,
      json("PATCH", { timeTrackingEnabled: false }),
    );
    const blocked = await Promise.all(calls());
    expect(blocked.map((response) => response.status)).toEqual([
      403, 403, 403, 403,
    ]);
    expect(await blocked[0]?.text()).toBe(
      "The Time tracking feature is turned off for this project.",
    );

    await app.request(
      `/api/project/${project.id}/features`,
      json("PATCH", { timeTrackingEnabled: true }),
    );
    const allowed = await Promise.all(calls());
    expect(allowed.map((response) => response.status)).toEqual([
      200, 200, 200, 200,
    ]);
  });

  it("starts a blank project with an active estimate system on project:create alone", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    // Members may create projects but not manage estimates afterwards.
    const member = await addWorkspaceMember(owner.workspace.id, "member");
    mockAuthenticatedSession(member);
    const { app } = createApp();
    const create = (body: Record<string, unknown>) =>
      app.request(
        "/api/project",
        json("POST", {
          name: "Sized",
          workspaceId: owner.workspace.id,
          icon: "Layout",
          ...body,
        }),
      );

    const created = await create({
      slug: "szd",
      estimate: {
        name: "Story points",
        type: "points",
        values: ["8", "1", "2", "3", "5", "13"],
      },
    });
    expect(created.status, await created.clone().text()).toBe(200);
    const project = (await created.json()) as {
      id: string;
      estimatesEnabled: boolean;
    };
    expect(project.estimatesEnabled).toBe(true);

    const list = (await (
      await app.request(`/api/estimate/${project.id}`)
    ).json()) as {
      activeEstimateId: string | null;
      estimates: { id: string; name: string; points: { value: string }[] }[];
    };
    const [system] = list.estimates;
    expect(list.activeEstimateId).toBe(system?.id);
    expect(system?.name).toBe("Story points");
    expect(system?.points.map((point) => point.value)).toEqual([
      "1",
      "2",
      "3",
      "5",
      "8",
      "13",
    ]);

    // Invalid values answer per value, and nothing is created.
    const invalid = await create({
      slug: "bad",
      estimate: { name: "Points", type: "points", values: ["1", "x"] },
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({
      errors: [{ index: 1, code: "not_numeric" }],
    });

    // A template or a source project brings its own setup.
    const withSource = await create({
      slug: "src",
      fromProjectId: project.id,
      estimate: { name: "Points", type: "points", values: ["1", "2"] },
    });
    expect(withSource.status).toBe(400);
  });
});
