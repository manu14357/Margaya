import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

// Project status updates (#7): the opt-in feature gate, who may read, post,
// edit and comment, restricted projects, the template draft without AI,
// follower notifications and the workspace roll-up.

type User = typeof schema.userTable.$inferSelect;

function json(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

async function as(user: User, path: string, init?: RequestInit) {
  mockAuthenticatedSession(user);
  const { app } = createApp();
  return app.request(`/api/project-update${path}`, init);
}

async function setup(options: { updatesEnabled?: boolean } = {}) {
  const owner = await createWorkspaceMember({ role: "owner" });
  const { project } = await createProjectFixture({
    workspaceId: owner.workspace.id,
  });
  if (options.updatesEnabled !== false) {
    await db
      .update(schema.projectTable)
      .set({ updatesEnabled: true })
      .where(eq(schema.projectTable.id, project.id));
  }
  const member = await addWorkspaceMember(owner.workspace.id, "member");
  const viewer = await addWorkspaceMember(owner.workspace.id, "viewer");
  return {
    owner: owner.user,
    workspace: owner.workspace,
    project,
    member,
    viewer,
  };
}

async function waitForNotifications(userId: string, type: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const rows = await db
      .select()
      .from(schema.notificationTable)
      .where(
        and(
          eq(schema.notificationTable.userId, userId),
          eq(schema.notificationTable.type, type),
        ),
      );
    if (rows.length > 0) return rows;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return [];
}

const post = {
  health: "at_risk",
  summary: "Two tasks are late.",
  blockers: "- [P-1] Login",
};

describe("API integration: project updates", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("rejects anonymous callers", async () => {
    const { project } = await setup();
    mockAnonymousSession();
    const { app } = createApp();
    const response = await app.request(
      `/api/project-update/project/${project.id}`,
    );
    expect(response.status).toBe(401);
  });

  it("answers 403 while the project's Updates feature is off", async () => {
    const { project, member } = await setup({ updatesEnabled: false });
    const response = await as(member, `/project/${project.id}`);
    expect(response.status).toBe(403);
  });

  it("lets a member post, a viewer read and react but not post", async () => {
    const { project, member, viewer } = await setup();

    const created = await as(
      member,
      `/project/${project.id}`,
      json("POST", post),
    );
    expect(created.status).toBe(200);
    const update = (await created.json()) as {
      id: string;
      health: string;
      aiProvenance: unknown;
      facts: { counts: { total: number } } | null;
      canEdit: boolean;
    };
    expect(update).toMatchObject({ health: "at_risk", canEdit: true });
    expect(update.aiProvenance).toBeNull();
    expect(update.facts?.counts.total).toBe(0);

    expect(
      (await as(viewer, `/project/${project.id}`, json("POST", post))).status,
    ).toBe(403);

    const list = await as(viewer, `/project/${project.id}`);
    expect(list.status).toBe(200);
    const page = (await list.json()) as {
      updates: { id: string; canEdit: boolean }[];
      nextCursor: string | null;
    };
    expect(page.updates.map((row) => row.id)).toEqual([update.id]);
    expect(page.updates[0]?.canEdit).toBe(false);
    expect(page.nextCursor).toBeNull();

    const reacted = await as(viewer, `/${update.id}/reaction/thumbs_up`, {
      method: "PUT",
    });
    expect(reacted.status).toBe(200);
    expect(await reacted.json()).toMatchObject([
      { emoji: "thumbs_up", count: 1, reacted: true },
    ]);
    const unreacted = await as(viewer, `/${update.id}/reaction/thumbs_up`, {
      method: "DELETE",
    });
    expect(await unreacted.json()).toEqual([]);
  });

  it("labels a posted AI draft and keeps the label, naming the editor", async () => {
    const { project, member } = await setup();
    const created = await as(
      member,
      `/project/${project.id}`,
      json("POST", { ...post, aiAssist: { feature: "project_update" } }),
    );
    const update = (await created.json()) as {
      id: string;
      aiProvenance: { source: string; feature: string } | null;
    };
    expect(update.aiProvenance).toMatchObject({
      source: "assist",
      feature: "project_update",
    });
    const edited = await as(
      member,
      `/${update.id}`,
      json("PATCH", { summary: "Back on track." }),
    );
    expect(await edited.json()).toMatchObject({
      summary: "Back on track.",
      aiProvenance: { source: "assist", editedById: member.id },
    });
  });

  it("lets only the author or a project manager edit and delete", async () => {
    const { project, member, owner, workspace } = await setup();
    const other = await addWorkspaceMember(workspace.id, "member");
    const created = await as(
      member,
      `/project/${project.id}`,
      json("POST", post),
    );
    const { id } = (await created.json()) as { id: string };

    expect(
      (await as(other, `/${id}`, json("PATCH", { health: "on_track" }))).status,
    ).toBe(403);
    expect((await as(other, `/${id}`, { method: "DELETE" })).status).toBe(403);
    expect((await as(owner, `/${id}`, { method: "DELETE" })).status).toBe(200);
    expect((await as(member, `/${id}`)).status).toBe(404);
  });

  it("hides a restricted project's updates from outsiders with 404", async () => {
    const { project, member, owner } = await setup();
    const created = await as(
      owner,
      `/project/${project.id}`,
      json("POST", post),
    );
    const { id } = (await created.json()) as { id: string };
    await db
      .update(schema.projectTable)
      .set({ visibility: "restricted" })
      .where(eq(schema.projectTable.id, project.id));

    expect((await as(member, `/project/${project.id}`)).status).toBe(404);
    expect((await as(member, `/${id}`)).status).toBe(404);
    const latest = await as(member, `/workspace/${project.workspaceId}/latest`);
    expect(await latest.json()).toEqual({ updates: [] });
  });

  it("drafts from the template when AI is off", async () => {
    const { project, member } = await setup();
    const response = await as(
      member,
      `/project/${project.id}/draft`,
      json("POST", { useAi: true }),
    );
    expect(response.status).toBe(200);
    const draft = (await response.json()) as {
      aiDrafted: boolean;
      aiUnavailable: string | null;
      draft: { health: string; summary: string };
      facts: { sinceLastUpdate: boolean };
    };
    expect(draft.aiDrafted).toBe(false);
    expect(draft.aiUnavailable).toBe("AI_DISABLED");
    expect(draft.draft.health).toBe("on_track");
    expect(draft.draft.summary).toContain("0% of tasks are complete");
    expect(draft.facts.sinceLastUpdate).toBe(false);
  });

  it("notifies followers and the lead, and commenters' partners", async () => {
    const { project, member, viewer, owner } = await setup();
    await db
      .update(schema.projectTable)
      .set({ leadUserId: owner.id })
      .where(eq(schema.projectTable.id, project.id));
    const follow = await as(
      viewer,
      `/project/${project.id}/follow`,
      json("PUT", { following: true }),
    );
    expect(await follow.json()).toEqual({ following: true, isLead: false });

    const created = await as(
      member,
      `/project/${project.id}`,
      json("POST", post),
    );
    const { id } = (await created.json()) as { id: string };
    expect(
      await waitForNotifications(viewer.id, "project_update_posted"),
    ).toHaveLength(1);
    const [leadRow] = await waitForNotifications(
      owner.id,
      "project_update_posted",
    );
    expect(leadRow).toMatchObject({
      resourceType: "project",
      resourceId: project.id,
      workspaceId: project.workspaceId,
    });

    const comment = await as(
      owner,
      `/${id}/comment`,
      json("POST", { content: "Thanks" }),
    );
    expect(comment.status).toBe(200);
    expect(
      await waitForNotifications(member.id, "project_update_comment"),
    ).toHaveLength(1);

    const detail = await as(member, `/${id}`);
    expect(await detail.json()).toMatchObject({
      commentCount: 1,
      comments: [{ content: "Thanks" }],
    });
  });

  it("lists the latest update of each project in the workspace roll-up", async () => {
    const { project, member } = await setup();
    await as(member, `/project/${project.id}`, json("POST", post));
    await as(
      member,
      `/project/${project.id}`,
      json("POST", { ...post, health: "on_track", summary: "Fixed." }),
    );
    const response = await as(
      member,
      `/workspace/${project.workspaceId}/latest`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      updates: [
        { projectId: project.id, health: "on_track", summary: "Fixed." },
      ],
    });
  });

  it("keeps the weekly reminder for project managers", async () => {
    const { project, member, owner } = await setup();
    expect(
      (
        await as(
          member,
          `/project/${project.id}/reminder`,
          json("PUT", { enabled: true }),
        )
      ).status,
    ).toBe(403);
    const saved = await as(
      owner,
      `/project/${project.id}/reminder`,
      json("PUT", { enabled: true, weekday: 1 }),
    );
    expect(await saved.json()).toEqual({
      enabled: true,
      weekday: 1,
      leadUserId: null,
    });
  });
});
