import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db from "../../apps/api/src/database";
import * as schema from "../../apps/api/src/database/schema";
import { createApp } from "../../apps/api/src/index";
import { handleCommand } from "../../apps/api/src/slack-app/inbound";
import { createLinkToken } from "../../apps/api/src/slack-app/link-token";
import { loadActiveConnection } from "../../apps/api/src/slack-app/store";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

const botToken = "xoxb-1111-2222-integrationsecretvalue";
const appToken = "xapp-1-A111-3333-integrationappsecret";

function json(app: ReturnType<typeof createApp>["app"]) {
  return (method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
}

describe("API integration: Slack app", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    vi.stubEnv("MARGAYA_CLIENT_URL", "https://pm.example.com");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("stores credentials encrypted, masks them and needs manage_settings", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const member = await addWorkspaceMember(owner.workspace.id, "member");
    const { app } = createApp();
    const request = json(app);
    const path = `/api/slack-app/workspace/${owner.workspace.id}`;

    mockAuthenticatedSession(member);
    expect((await request("GET", path)).status).toBe(403);
    expect((await request("POST", path, { botToken, appToken })).status).toBe(
      403,
    );

    vi.restoreAllMocks();
    mockAuthenticatedSession(owner.user);
    const empty = await (await request("GET", path)).json();
    expect(empty.connection).toBeNull();
    expect(empty.setup.manifests.socket).toContain("socket_mode_enabled");

    // Socket Mode needs the app-level token.
    expect((await request("POST", path, { botToken })).status).toBe(400);
    expect(
      (await request("POST", path, { botToken: "not-a-token", appToken }))
        .status,
    ).toBe(400);

    const created = await request("POST", path, { botToken, appToken });
    expect(created.status).toBe(200);
    const body = await created.json();
    const text = JSON.stringify(body);
    expect(text).not.toContain("integrationsecretvalue");
    expect(text).not.toContain("integrationappsecret");
    expect(body.connection).toMatchObject({
      mode: "socket",
      botTokenConfigured: true,
      maskedBotToken: "xoxb-…alue",
      appTokenConfigured: true,
      isActive: true,
    });

    const [row] = await db
      .select()
      .from(schema.slackConnectionTable)
      .where(eq(schema.slackConnectionTable.workspaceId, owner.workspace.id));
    expect(row?.botToken).not.toContain("integrationsecretvalue");
    expect((await loadActiveConnection(owner.workspace.id))?.botToken).toBe(
      botToken,
    );

    // Switching to HTTP mode needs the signing secret; omitted tokens stay.
    expect((await request("PATCH", path, { mode: "http" })).status).toBe(400);
    const updated = await request("PATCH", path, {
      mode: "http",
      signingSecret: "8f742231b10e8888abcd99yyyzzz85a5",
      expandTaskKeys: true,
    });
    expect(updated.status).toBe(200);
    expect((await updated.json()).connection).toMatchObject({
      mode: "http",
      botTokenConfigured: true,
      signingSecretConfigured: true,
      expandTaskKeys: true,
    });

    expect((await request("DELETE", path)).status).toBe(200);
    expect((await request("DELETE", path)).status).toBe(404);
  });

  it("links a member's Slack account and runs commands as that member", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const member = await addWorkspaceMember(owner.workspace.id, "member");
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
      slug: "web",
    });
    const { app } = createApp();
    const request = json(app);
    mockAuthenticatedSession(owner.user);
    await request("POST", `/api/slack-app/workspace/${owner.workspace.id}`, {
      botToken,
      appToken,
      defaultProjectId: project.id,
    });
    await db
      .update(schema.slackConnectionTable)
      .set({ teamId: "T1" })
      .where(eq(schema.slackConnectionTable.workspaceId, owner.workspace.id));
    const connection = await loadActiveConnection(owner.workspace.id);
    if (!connection) throw new Error("no connection");

    // Unlinked: a link prompt, and nothing is created.
    const prompt = await handleCommand(connection, {
      team_id: "T1",
      user_id: "U-MEMBER",
      text: "add Fix the login",
    });
    expect(prompt.text).toContain("Link your Slack account");

    const token = createLinkToken({
      workspaceId: owner.workspace.id,
      teamId: "T1",
      slackUserId: "U-MEMBER",
      slackUserName: "member",
    });

    // Someone outside the workspace can't take the link.
    const outsider = await createWorkspaceMember({ role: "owner" });
    vi.restoreAllMocks();
    mockAuthenticatedSession(outsider.user);
    expect(
      (await request("POST", "/api/slack-app/links", { token })).status,
    ).not.toBe(200);

    vi.restoreAllMocks();
    mockAuthenticatedSession(member);
    const preview = await request("POST", "/api/slack-app/links/preview", {
      token,
    });
    expect(await preview.json()).toMatchObject({
      workspaceId: owner.workspace.id,
      linkedToYou: false,
    });
    expect(
      (await request("POST", "/api/slack-app/links", { token })).status,
    ).toBe(200);
    const links = await (await request("GET", "/api/slack-app/links")).json();
    expect(links).toHaveLength(1);

    const reply = await handleCommand(connection, {
      team_id: "T1",
      user_id: "U-MEMBER",
      text: "add WEB Fix the login !high",
    });
    expect(reply.text).toContain("WEB-");
    const [task] = await db
      .select()
      .from(schema.taskTable)
      .where(eq(schema.taskTable.projectId, project.id));
    expect(task).toMatchObject({
      title: "Fix the login",
      priority: "high",
      createdBy: member.id,
    });
    // The one-action key is gone.
    const keys = await db
      .select()
      .from(schema.apikeyTable)
      .where(eq(schema.apikeyTable.userId, member.id));
    expect(keys).toHaveLength(0);

    // Unlinking stops it.
    expect(
      (await request("DELETE", `/api/slack-app/links/${links[0].id}`)).status,
    ).toBe(200);
    const after = await handleCommand(connection, {
      team_id: "T1",
      user_id: "U-MEMBER",
      text: "search login",
    });
    expect(after.text).toContain("Link your Slack account");
  });

  it("refuses what the linked member's role refuses", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const viewer = await addWorkspaceMember(owner.workspace.id, "viewer");
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
      slug: "ops",
    });
    const { app } = createApp();
    mockAuthenticatedSession(owner.user);
    await json(app)("POST", `/api/slack-app/workspace/${owner.workspace.id}`, {
      botToken,
      appToken,
      defaultProjectId: project.id,
    });
    await db.insert(schema.slackUserLinkTable).values({
      workspaceId: owner.workspace.id,
      slackTeamId: "T1",
      slackUserId: "U-VIEWER",
      userId: viewer.id,
    });
    const connection = await loadActiveConnection(owner.workspace.id);
    if (!connection) throw new Error("no connection");

    const reply = await handleCommand(connection, {
      team_id: "T1",
      user_id: "U-VIEWER",
      text: "add Should not exist",
    });
    expect(reply.text).toContain("isn't allowed");
    const tasks = await db
      .select()
      .from(schema.taskTable)
      .where(eq(schema.taskTable.projectId, project.id));
    expect(tasks).toHaveLength(0);
  });
});
