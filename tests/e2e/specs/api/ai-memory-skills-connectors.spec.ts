import type { APIRequestContext, APIResponse } from "@playwright/test";
import { expect, test } from "../../fixtures";
import {
  createProject,
  createWorld,
  expectJson,
  expectStatus,
  type Project,
  signUpUser,
  type TestUser,
  type World,
} from "../../helpers/api-kit";
import { covers } from "../../helpers/openapi";
import { uniqueName } from "../../helpers/ui";
import type { ReceivedRequest, WebhookSink } from "../../helpers/webhook-sink";

// AI memory notes, skills, MCP connectors, feedback, budget status, the usage
// CSV and the natural-language filter, on an instance where AI is off. Notes,
// skills, connectors, feedback and the budget and usage reads are plain data
// and work without a provider; a connector test talks to a fake MCP server
// served by the webhook sink; the filter parser needs a model and answers
// 403 AI_DISABLED. Settings change only in this file's own workspace and are
// restored before it ends.

type Note = {
  id: string;
  scope: "workspace" | "project" | "user";
  projectId: string | null;
  content: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
};

type Skill = {
  id: string;
  name: string;
  description: string | null;
  prompt: string;
  shared: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
};

type Connector = {
  id: string;
  name: string;
  shared: boolean;
  ownerId: string | null;
  url: string | null;
  authType: "none" | "header";
  headerName: string | null;
  hasSecret: boolean;
  secretLast4: string | null;
  enabled: boolean;
  canManage: boolean;
};

type ConnectorTest = {
  ok: boolean;
  error: string | null;
  httpStatus: number | null;
  tools: { name: string; description: string; readOnly: boolean }[];
};

type BudgetStatus = {
  monthlyCapMicros: number | null;
  usedMicros: number | null;
  usedPercent: number | null;
  warning: boolean;
  month: string;
};

const UNKNOWN = "e2e-unknown-id";

let world: World;
let outsider: TestUser;
let project: Project;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  world = await createWorld("AI memory");
  outsider = await signUpUser("AI memory outsider");
  project = await createProject(world.as("owner"), world.workspace.id);
});

test.afterAll(async () => {
  // Leave the workspace without a budget cap whatever happened above.
  await world
    ?.as("owner")
    .patch("/api/ai/settings", {
      data: { workspaceId: world.workspace.id, monthlyCapMicros: null },
    })
    .catch(() => undefined);
  await outsider?.ctx.dispose();
  await world?.dispose();
});

const ws = () => ({ workspaceId: world.workspace.id });

/** The JSON error body of the AI guard ({ code, message }). */
async function expectAiDisabled(response: APIResponse) {
  const text = await expectStatus(response, 403);
  expect(JSON.parse(text)).toMatchObject({ code: "AI_DISABLED" });
}

async function listNotes(ctx: APIRequestContext, projectId?: string) {
  const body = await expectJson<{ notes: Note[] }>(
    await ctx.get("/api/ai/memory", {
      params: projectId ? { ...ws(), projectId } : ws(),
    }),
  );
  return body.notes;
}

async function listSkills(ctx: APIRequestContext) {
  const body = await expectJson<{ skills: Skill[] }>(
    await ctx.get("/api/ai/skills", { params: ws() }),
  );
  return body.skills;
}

async function listConnectors(ctx: APIRequestContext) {
  return expectJson<Connector[]>(
    await ctx.get("/api/ai/connectors", { params: ws() }),
  );
}

test(
  "memory notes: workspace, project and private notes, per role",
  covers(
    "listAiMemoryNotes",
    "createAiMemoryNote",
    "updateAiMemoryNote",
    "deleteAiMemoryNote",
  ),
  async () => {
    const admin = world.as("admin");
    const member = world.as("member");
    expect(await listNotes(world.as("owner"))).toEqual([]);

    const workspaceNote = await expectJson<Note>(
      await admin.post("/api/ai/memory", {
        data: {
          ...ws(),
          scope: "workspace",
          content: "  Our release day is Thursday.  ",
        },
      }),
    );
    expect(workspaceNote).toMatchObject({
      scope: "workspace",
      projectId: null,
      content: "Our release day is Thursday.",
      createdBy: world.users.admin.id,
      canEdit: true,
    });
    const projectNote = await expectJson<Note>(
      await admin.post("/api/ai/memory", {
        data: {
          ...ws(),
          scope: "project",
          projectId: project.id,
          content: "This project ships the mobile app.",
        },
      }),
    );
    expect(projectNote).toMatchObject({
      scope: "project",
      projectId: project.id,
      canEdit: true,
    });
    // A member (ai:use without ai:manage) keeps private notes only.
    const memberNote = await expectJson<Note>(
      await member.post("/api/ai/memory", {
        data: { ...ws(), scope: "user", content: "I review on Mondays." },
      }),
    );
    expect(memberNote).toMatchObject({
      scope: "user",
      projectId: null,
      createdBy: world.users.member.id,
      canEdit: true,
    });
    for (const scope of ["workspace", "project"] as const) {
      await expectStatus(
        await member.post("/api/ai/memory", {
          data: {
            ...ws(),
            scope,
            projectId: project.id,
            content: "Not allowed",
          },
        }),
        403,
      );
    }

    // Invalid bodies, a project note without or with an unknown project.
    expect(
      await expectStatus(
        await admin.post("/api/ai/memory", {
          data: { ...ws(), scope: "project", content: "Which project?" },
        }),
        400,
      ),
    ).toContain("projectId");
    await expectStatus(
      await admin.post("/api/ai/memory", {
        data: {
          ...ws(),
          scope: "project",
          projectId: UNKNOWN,
          content: "Nowhere",
        },
      }),
      404,
    );
    for (const data of [
      { ...ws(), scope: "workspace", content: "   " },
      { ...ws(), scope: "workspace", content: "x".repeat(501) },
      { ...ws(), scope: "team", content: "Unknown scope" },
      { ...ws(), scope: "workspace", content: "Extra", pinned: true },
    ]) {
      await expectStatus(await admin.post("/api/ai/memory", { data }), 400);
    }

    // Workspace and project notes first, then the caller's own; nobody else
    // sees a private note.
    const memberView = await listNotes(member);
    expect(memberView.map((note) => note.id)).toEqual([
      workspaceNote.id,
      projectNote.id,
      memberNote.id,
    ]);
    expect(memberView.map((note) => note.canEdit)).toEqual([
      false,
      false,
      true,
    ]);
    const adminView = await listNotes(admin);
    expect(adminView.map((note) => note.id)).toEqual([
      workspaceNote.id,
      projectNote.id,
    ]);
    expect(
      (await listNotes(member, project.id)).map((note) => note.id),
    ).toEqual([workspaceNote.id, projectNote.id, memberNote.id]);
    expect((await listNotes(member, UNKNOWN)).map((note) => note.id)).toEqual([
      workspaceNote.id,
      memberNote.id,
    ]);

    // No ai:use, no workspace access, no session.
    await expectStatus(
      await world.as("viewer").get("/api/ai/memory", { params: ws() }),
      403,
    );
    await expectStatus(
      await world.as("viewer").post("/api/ai/memory", {
        data: { ...ws(), scope: "user", content: "Viewer note" },
      }),
      403,
    );
    await expectStatus(
      await outsider.ctx.get("/api/ai/memory", { params: ws() }),
      403,
    );
    await expectStatus(
      await world.as("anonymous").get("/api/ai/memory", { params: ws() }),
      401,
    );

    // Updates: own note, or ai:manage for shared notes.
    const updated = await expectJson<Note>(
      await member.patch(`/api/ai/memory/${memberNote.id}`, {
        params: ws(),
        data: { content: "I review on Tuesdays." },
      }),
    );
    expect(updated).toMatchObject({
      id: memberNote.id,
      content: "I review on Tuesdays.",
      canEdit: true,
    });
    const reworded = await expectJson<Note>(
      await world.as("owner").patch(`/api/ai/memory/${workspaceNote.id}`, {
        params: ws(),
        data: { content: "Our release day is Wednesday." },
      }),
    );
    expect(reworded.content).toBe("Our release day is Wednesday.");
    await expectStatus(
      await member.patch(`/api/ai/memory/${workspaceNote.id}`, {
        params: ws(),
        data: { content: "Member edit" },
      }),
      403,
    );
    // Someone else's private note reads as missing, even for an admin.
    await expectStatus(
      await admin.patch(`/api/ai/memory/${memberNote.id}`, {
        params: ws(),
        data: { content: "Admin edit" },
      }),
      404,
    );
    await expectStatus(
      await admin.patch(`/api/ai/memory/${UNKNOWN}`, {
        params: ws(),
        data: { content: "Nothing" },
      }),
      404,
    );
    for (const data of [{ content: "" }, { content: "Ok", scope: "user" }]) {
      await expectStatus(
        await member.patch(`/api/ai/memory/${memberNote.id}`, {
          params: ws(),
          data,
        }),
        400,
      );
    }
    await expectStatus(
      await outsider.ctx.patch(`/api/ai/memory/${workspaceNote.id}`, {
        params: ws(),
        data: { content: "Outsider" },
      }),
      403,
    );

    // Deletes follow the same rules.
    await expectStatus(
      await member.delete(`/api/ai/memory/${projectNote.id}`, { params: ws() }),
      403,
    );
    await expectStatus(
      await admin.delete(`/api/ai/memory/${memberNote.id}`, { params: ws() }),
      404,
    );
    await expectStatus(
      await world
        .as("anonymous")
        .delete(`/api/ai/memory/${memberNote.id}`, { params: ws() }),
      401,
    );
    for (const [ctx, id] of [
      [member, memberNote.id],
      [admin, projectNote.id],
      [world.as("owner"), workspaceNote.id],
    ] as const) {
      expect(
        await expectJson<{ id: string }>(
          await ctx.delete(`/api/ai/memory/${id}`, { params: ws() }),
        ),
      ).toEqual({ id });
    }
    await expectStatus(
      await admin.delete(`/api/ai/memory/${projectNote.id}`, { params: ws() }),
      404,
    );
    expect(await listNotes(member)).toEqual([]);
  },
);

test(
  "skills: shared and private prompts, creator or ai:manage edits",
  covers("listAiSkills", "createAiSkill", "updateAiSkill", "deleteAiSkill"),
  async () => {
    const admin = world.as("admin");
    const member = world.as("member");
    expect(await listSkills(member)).toEqual([]);

    const sharedName = uniqueName("Release notes");
    const shared = await expectJson<Skill>(
      await admin.post("/api/ai/skills", {
        data: {
          ...ws(),
          name: `  ${sharedName}  `,
          description: "Writes release notes",
          prompt: "Summarise the finished tasks as release notes.",
        },
      }),
    );
    expect(shared).toMatchObject({
      name: sharedName,
      description: "Writes release notes",
      prompt: "Summarise the finished tasks as release notes.",
      shared: true,
      createdBy: world.users.admin.id,
      canEdit: true,
    });
    // Any ai:use member may save skills; a private one stays theirs.
    const privateName = uniqueName("My standup");
    const own = await expectJson<Skill>(
      await member.post("/api/ai/skills", {
        data: {
          ...ws(),
          name: privateName,
          description: "",
          prompt: "List what I did yesterday.",
          shared: false,
        },
      }),
    );
    expect(own).toMatchObject({
      name: privateName,
      description: null,
      shared: false,
      createdBy: world.users.member.id,
      canEdit: true,
    });

    for (const data of [
      { ...ws(), name: "", prompt: "Something" },
      { ...ws(), name: "No prompt", prompt: "  " },
      { ...ws(), name: "x".repeat(81), prompt: "Too long a name" },
      { ...ws(), name: "Long", prompt: "x".repeat(4_001) },
      { ...ws(), name: "Long", prompt: "Ok", description: "x".repeat(301) },
      { ...ws(), name: "Extra", prompt: "Ok", agentId: UNKNOWN },
    ]) {
      await expectStatus(await member.post("/api/ai/skills", { data }), 400);
    }

    // Shared skills for everyone with ai:use, private ones for the creator.
    const memberView = await listSkills(member);
    expect(memberView.map((skill) => skill.id).sort()).toEqual(
      [shared.id, own.id].sort(),
    );
    expect(memberView.find((skill) => skill.id === shared.id)?.canEdit).toBe(
      false,
    );
    expect((await listSkills(admin)).map((skill) => skill.id)).toEqual([
      shared.id,
    ]);
    for (const ctx of [world.as("viewer"), outsider.ctx]) {
      await expectStatus(
        await ctx.get("/api/ai/skills", { params: ws() }),
        403,
      );
      await expectStatus(
        await ctx.post("/api/ai/skills", {
          data: { ...ws(), name: "Refused", prompt: "Refused" },
        }),
        403,
      );
    }
    await expectStatus(
      await world.as("anonymous").get("/api/ai/skills", { params: ws() }),
      401,
    );

    // The creator edits their own; ai:manage edits any shared skill.
    const shareIt = await expectJson<Skill>(
      await member.patch(`/api/ai/skills/${own.id}`, {
        params: ws(),
        data: { shared: true, description: "Daily standup" },
      }),
    );
    expect(shareIt).toMatchObject({
      id: own.id,
      name: privateName,
      shared: true,
      description: "Daily standup",
    });
    const managed = await expectJson<Skill>(
      await admin.patch(`/api/ai/skills/${own.id}`, {
        params: ws(),
        data: {
          prompt: "List what I did yesterday and today.",
          description: null,
        },
      }),
    );
    expect(managed).toMatchObject({
      prompt: "List what I did yesterday and today.",
      description: null,
      canEdit: true,
    });
    // An empty change answers the skill as it is.
    expect(
      await expectJson<Skill>(
        await member.patch(`/api/ai/skills/${own.id}`, {
          params: ws(),
          data: {},
        }),
      ),
    ).toMatchObject({ id: own.id, prompt: managed.prompt });
    await expectStatus(
      await member.patch(`/api/ai/skills/${shared.id}`, {
        params: ws(),
        data: { name: "Member rename" },
      }),
      403,
    );
    await expectStatus(
      await member.patch(`/api/ai/skills/${own.id}`, {
        params: ws(),
        data: { name: "" },
      }),
      400,
    );
    await expectStatus(
      await admin.patch(`/api/ai/skills/${UNKNOWN}`, {
        params: ws(),
        data: { name: "Ghost" },
      }),
      404,
    );

    // Private again: the admin no longer sees it, so it reads as missing.
    await expectJson(
      await member.patch(`/api/ai/skills/${own.id}`, {
        params: ws(),
        data: { shared: false },
      }),
    );
    await expectStatus(
      await admin.patch(`/api/ai/skills/${own.id}`, {
        params: ws(),
        data: { name: "Admin rename" },
      }),
      404,
    );
    await expectStatus(
      await admin.delete(`/api/ai/skills/${own.id}`, { params: ws() }),
      404,
    );
    await expectStatus(
      await member.delete(`/api/ai/skills/${shared.id}`, { params: ws() }),
      403,
    );
    await expectStatus(
      await world
        .as("anonymous")
        .delete(`/api/ai/skills/${shared.id}`, { params: ws() }),
      401,
    );
    for (const [ctx, id] of [
      [member, own.id],
      [world.as("owner"), shared.id],
    ] as const) {
      expect(
        await expectJson<{ id: string }>(
          await ctx.delete(`/api/ai/skills/${id}`, { params: ws() }),
        ),
      ).toEqual({ id });
    }
    await expectStatus(
      await member.delete(`/api/ai/skills/${own.id}`, { params: ws() }),
      404,
    );
    expect(await listSkills(member)).toEqual([]);
  },
);

/** A Streamable HTTP MCP server with two tools that wants `secret`. */
function serveFakeMcp(sink: WebhookSink, secret: string) {
  sink.respondWith((request: ReceivedRequest) => {
    const rpc = (request.json ?? {}) as { id?: number; method?: string };
    const json = (body: unknown, status = 200) => ({
      status,
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        "mcp-session-id": "e2e-session",
      },
    });
    if (request.headers["x-e2e-token"] !== secret) {
      return json({ error: "unauthorized" }, 401);
    }
    if (rpc.method === "notifications/initialized") return { status: 202 };
    if (rpc.method === "initialize") {
      return json({
        jsonrpc: "2.0",
        id: rpc.id,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "e2e-mcp", version: "1.0.0" },
        },
      });
    }
    if (rpc.method === "tools/list") {
      return json({
        jsonrpc: "2.0",
        id: rpc.id,
        result: {
          tools: [
            {
              name: "search_docs",
              description: "Search the docs",
              inputSchema: { type: "object", properties: {} },
              annotations: { readOnlyHint: true },
            },
            {
              name: "open_ticket",
              description: "Open a ticket",
              inputSchema: { type: "object", properties: {} },
            },
          ],
        },
      });
    }
    return json({
      jsonrpc: "2.0",
      id: rpc.id,
      error: { code: -32601, message: "Method not found" },
    });
  });
}

test(
  "MCP connectors: shared and personal, sealed secrets, test against a fake server",
  covers(
    "listAiConnectors",
    "createAiConnector",
    "updateAiConnector",
    "deleteAiConnector",
    "testAiConnector",
  ),
  async ({ webhookSink }) => {
    const admin = world.as("admin");
    const member = world.as("member");
    const secret = "Bearer e2e-connector-secret-9f3k";
    const mcpUrl = `${webhookSink.url}/mcp`;
    serveFakeMcp(webhookSink, secret);
    expect(await listConnectors(member)).toEqual([]);

    const sharedName = uniqueName("Docs");
    const shared = await expectJson<Connector>(
      await admin.post("/api/ai/connectors", {
        data: {
          ...ws(),
          name: sharedName,
          url: mcpUrl,
          authType: "header",
          headerName: "X-E2E-Token",
          secret,
          shared: true,
        },
      }),
    );
    expect(shared).toMatchObject({
      name: sharedName,
      shared: true,
      ownerId: null,
      url: mcpUrl,
      authType: "header",
      headerName: "X-E2E-Token",
      hasSecret: true,
      secretLast4: "9f3k",
      enabled: true,
      canManage: true,
    });
    // The secret itself never comes back.
    expect(JSON.stringify(shared)).not.toContain("e2e-connector-secret");

    const personal = await expectJson<Connector>(
      await member.post("/api/ai/connectors", {
        data: {
          ...ws(),
          name: uniqueName("Mine"),
          url: `${webhookSink.url}/personal`,
          authType: "none",
          shared: false,
        },
      }),
    );
    expect(personal).toMatchObject({
      shared: false,
      ownerId: world.users.member.id,
      authType: "none",
      headerName: null,
      hasSecret: false,
      secretLast4: null,
      canManage: true,
    });

    // Shared connectors need ai:manage; bodies are checked.
    await expectStatus(
      await member.post("/api/ai/connectors", {
        data: {
          ...ws(),
          name: "Member shared",
          url: mcpUrl,
          authType: "none",
          shared: true,
        },
      }),
      403,
    );
    for (const data of [
      {
        ...ws(),
        name: "Ftp",
        url: "ftp://example.com/mcp",
        authType: "none",
        shared: false,
      },
      { ...ws(), name: "", url: mcpUrl, authType: "none", shared: false },
      { ...ws(), name: "Auth", url: mcpUrl, authType: "oauth", shared: false },
      {
        ...ws(),
        name: "Reserved",
        url: mcpUrl,
        authType: "header",
        headerName: "Cookie",
        secret: "x",
        shared: false,
      },
      { ...ws(), name: "No shared flag", url: mcpUrl, authType: "none" },
      {
        ...ws(),
        name: "Extra",
        url: mcpUrl,
        authType: "none",
        shared: false,
        tools: [],
      },
    ]) {
      await expectStatus(
        await member.post("/api/ai/connectors", { data }),
        400,
      );
    }
    for (const ctx of [world.as("viewer"), outsider.ctx]) {
      await expectStatus(
        await ctx.get("/api/ai/connectors", { params: ws() }),
        403,
      );
    }
    await expectStatus(
      await world.as("anonymous").get("/api/ai/connectors", { params: ws() }),
      401,
    );

    // A member sees the shared connector without its URL or secret hint.
    const memberView = await listConnectors(member);
    const seenShared = memberView.find((row) => row.id === shared.id);
    expect(seenShared).toMatchObject({
      url: null,
      secretLast4: null,
      hasSecret: true,
      canManage: false,
    });
    expect(memberView.map((row) => row.id).sort()).toEqual(
      [shared.id, personal.id].sort(),
    );
    // A personal connector is invisible to everyone else.
    expect((await listConnectors(admin)).map((row) => row.id)).toEqual([
      shared.id,
    ]);

    // The test connects, initializes and lists the tools with the secret.
    webhookSink.clear();
    const tested = await expectJson<ConnectorTest>(
      await admin.post(`/api/ai/connectors/${shared.id}/test`, { data: ws() }),
    );
    expect(tested).toEqual({
      ok: true,
      error: null,
      httpStatus: null,
      tools: [
        { name: "search_docs", description: "Search the docs", readOnly: true },
        { name: "open_ticket", description: "Open a ticket", readOnly: false },
      ],
    });
    const methods = webhookSink.requests.map(
      (request) => (request.json as { method?: string } | undefined)?.method,
    );
    expect(methods).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/list",
    ]);
    expect(webhookSink.requests.at(-1)?.headers["mcp-session-id"]).toBe(
      "e2e-session",
    );

    // A wrong secret is reported with the server's status, not thrown.
    const rotated = await expectJson<Connector>(
      await admin.patch(`/api/ai/connectors/${shared.id}`, {
        data: { ...ws(), secret: "Bearer wrong-secret-0000", enabled: false },
      }),
    );
    expect(rotated).toMatchObject({
      hasSecret: true,
      secretLast4: "0000",
      enabled: false,
      headerName: "X-E2E-Token",
    });
    expect(
      await expectJson<ConnectorTest>(
        await admin.post(`/api/ai/connectors/${shared.id}/test`, {
          data: ws(),
        }),
      ),
    ).toEqual({ ok: false, error: "HTTP", httpStatus: 401, tools: [] });

    // Only the owner, or ai:manage for shared ones, changes or tests.
    await expectStatus(
      await member.patch(`/api/ai/connectors/${shared.id}`, {
        data: { ...ws(), name: "Member rename" },
      }),
      403,
    );
    await expectStatus(
      await member.post(`/api/ai/connectors/${shared.id}/test`, {
        data: ws(),
      }),
      403,
    );
    await expectStatus(
      await member.delete(`/api/ai/connectors/${shared.id}`, { params: ws() }),
      403,
    );
    for (const call of [
      admin.patch(`/api/ai/connectors/${personal.id}`, {
        data: { ...ws(), name: "Admin rename" },
      }),
      admin.post(`/api/ai/connectors/${personal.id}/test`, { data: ws() }),
      admin.delete(`/api/ai/connectors/${personal.id}`, { params: ws() }),
      admin.patch(`/api/ai/connectors/${UNKNOWN}`, {
        data: { ...ws(), name: "Ghost" },
      }),
      admin.post(`/api/ai/connectors/${UNKNOWN}/test`, { data: ws() }),
    ]) {
      await expectStatus(await call, 404);
    }
    await expectStatus(
      await member.patch(`/api/ai/connectors/${personal.id}`, {
        data: { ...ws(), headerName: "Host" },
      }),
      400,
    );
    await expectStatus(
      await world
        .as("anonymous")
        .post(`/api/ai/connectors/${personal.id}/test`, { data: ws() }),
      401,
    );

    // The member's own connector: a server that is not MCP fails the test.
    const switched = await expectJson<Connector>(
      await member.patch(`/api/ai/connectors/${personal.id}`, {
        data: {
          ...ws(),
          authType: "header",
          secret: "short",
          url: `${webhookSink.url}/personal-v2`,
        },
      }),
    );
    expect(switched).toMatchObject({
      authType: "header",
      headerName: "Authorization",
      hasSecret: true,
      // Too short to show a hint.
      secretLast4: null,
      url: `${webhookSink.url}/personal-v2`,
    });
    expect(
      await expectJson<ConnectorTest>(
        await member.post(`/api/ai/connectors/${personal.id}/test`, {
          data: ws(),
        }),
      ),
    ).toMatchObject({ ok: false, httpStatus: 401, tools: [] });
    // Back to no auth drops the header and the secret.
    expect(
      await expectJson<Connector>(
        await member.patch(`/api/ai/connectors/${personal.id}`, {
          data: { ...ws(), authType: "none" },
        }),
      ),
    ).toMatchObject({ authType: "none", headerName: null, hasSecret: false });

    for (const [ctx, id] of [
      [member, personal.id],
      [world.as("owner"), shared.id],
    ] as const) {
      expect(
        await expectJson<{ id: string }>(
          await ctx.delete(`/api/ai/connectors/${id}`, { params: ws() }),
        ),
      ).toEqual({ id });
    }
    await expectStatus(
      await admin.delete(`/api/ai/connectors/${shared.id}`, { params: ws() }),
      404,
    );
    expect(await listConnectors(member)).toEqual([]);
  },
);

test(
  "feedback is recorded without text, and the usage CSV is a header only",
  covers("createAiFeedback", "exportAiUsage"),
  async () => {
    const member = world.as("member");
    for (const data of [
      {
        ...ws(),
        feature: "ask",
        rating: 1,
        reason: "Spot on",
        provider: "anthropic",
        model: "claude-e2e",
      },
      { ...ws(), feature: "translate", rating: -1 },
    ]) {
      const created = await expectJson<{ id: string }>(
        await member.post("/api/ai/feedback", { data }),
      );
      expect(created.id).toBeTruthy();
    }
    for (const data of [
      { ...ws(), feature: "ask", rating: 0 },
      { ...ws(), feature: "ask", rating: 5 },
      { ...ws(), feature: "no_such_feature", rating: 1 },
      { ...ws(), feature: "ask", rating: 1, reason: "x".repeat(301) },
      { ...ws(), feature: "ask", rating: 1, answer: "Never stored" },
    ]) {
      await expectStatus(await member.post("/api/ai/feedback", { data }), 400);
    }
    await expectStatus(
      await member.post("/api/ai/feedback", {
        data: { ...ws(), feature: "ask", rating: 1, reason: "x".repeat(9_000) },
      }),
      413,
    );
    for (const ctx of [world.as("viewer"), outsider.ctx]) {
      await expectStatus(
        await ctx.post("/api/ai/feedback", {
          data: { ...ws(), feature: "ask", rating: 1 },
        }),
        403,
      );
    }
    await expectStatus(
      await world.as("anonymous").post("/api/ai/feedback", {
        data: { ...ws(), feature: "ask", rating: 1 },
      }),
      401,
    );

    // The rates show on the usage page; no model was ever called.
    const usage = await expectJson<{
      totals: { calls: number };
      feedback: {
        up: number;
        down: number;
        byFeature: { feature: string; up: number; down: number }[];
      };
    }>(await world.as("owner").get("/api/ai/usage", { params: ws() }));
    expect(usage.totals.calls).toBe(0);
    expect(usage.feedback).toMatchObject({ up: 1, down: 1 });
    expect(
      [...usage.feedback.byFeature].sort((a, b) =>
        a.feature.localeCompare(b.feature),
      ),
    ).toEqual([
      { feature: "ask", up: 1, down: 0 },
      { feature: "translate", up: 0, down: 1 },
    ]);

    // The CSV export: the ledger is empty, so a BOM and the header row.
    const response = await world.as("admin").get("/api/ai/usage/export", {
      params: { ...ws(), from: "2030-01-01", to: "2030-01-31" },
    });
    expect(response.status()).toBe(200);
    const headers = response.headers();
    expect(headers["content-type"]).toContain("text/csv");
    expect(headers["content-disposition"]).toBe(
      'attachment; filename="ai-usage-2030-01-01-2030-01-31.csv"',
    );
    expect(headers["cache-control"]).toBe("no-store");
    const csv = (await response.body()).toString("utf8");
    expect(csv).toBe(
      '﻿"day","feature","provider","model","user_id","user","calls","input_tokens","output_tokens","cost_usd"\r\n',
    );
    // The default range (this month) has no ledger rows either.
    const month = await world
      .as("owner")
      .get("/api/ai/usage/export", { params: ws() });
    expect(month.status()).toBe(200);
    expect((await month.body()).toString("utf8").split("\r\n")).toHaveLength(2);

    for (const range of [
      { from: "2030-02-01", to: "2030-01-01" } as Record<string, string>,
      { from: "2028-01-01", to: "2030-01-01" },
      { to: "2030-1-01" },
    ]) {
      await expectStatus(
        await world
          .as("admin")
          .get("/api/ai/usage/export", { params: { ...ws(), ...range } }),
        400,
      );
    }
    for (const ctx of [member, world.as("viewer"), outsider.ctx]) {
      await expectStatus(
        await ctx.get("/api/ai/usage/export", { params: ws() }),
        403,
      );
    }
    await expectStatus(
      await world.as("anonymous").get("/api/ai/usage/export", { params: ws() }),
      401,
    );
  },
);

test(
  "budget status: amounts for ai:manage, the percentage for everyone with ai:use",
  covers("getAiBudgetStatus"),
  async () => {
    const month = new Date().toISOString().slice(0, 7);
    const budget = (ctx: APIRequestContext) =>
      ctx.get("/api/ai/budget-status", { params: ws() });

    expect(
      await expectJson<BudgetStatus>(await budget(world.as("owner"))),
    ).toEqual({
      monthlyCapMicros: null,
      usedMicros: 0,
      usedPercent: null,
      warning: false,
      month,
    });

    await expectJson(
      await world.as("admin").patch("/api/ai/settings", {
        data: { ...ws(), monthlyCapMicros: 5_000_000 },
      }),
    );
    try {
      expect(
        await expectJson<BudgetStatus>(await budget(world.as("admin"))),
      ).toEqual({
        monthlyCapMicros: 5_000_000,
        usedMicros: 0,
        usedPercent: 0,
        warning: false,
        month,
      });
      // A member sees how far along the budget is, not the amounts.
      expect(
        await expectJson<BudgetStatus>(await budget(world.as("member"))),
      ).toEqual({
        monthlyCapMicros: null,
        usedMicros: null,
        usedPercent: 0,
        warning: false,
        month,
      });
    } finally {
      await expectJson(
        await world.as("owner").patch("/api/ai/settings", {
          data: { ...ws(), monthlyCapMicros: null },
        }),
      );
    }
    expect(
      (await expectJson<BudgetStatus>(await budget(world.as("member"))))
        .usedPercent,
    ).toBeNull();

    for (const ctx of [world.as("viewer"), outsider.ctx]) {
      await expectStatus(await budget(ctx), 403);
    }
    await expectStatus(await budget(world.as("anonymous")), 401);
  },
);

test(
  "the filter parser needs a model: AI_DISABLED after access and ai:use",
  covers("aiParseTaskFilter"),
  async () => {
    const data = {
      ...ws(),
      projectId: project.id,
      text: "my overdue bugs",
    };
    for (const role of ["owner", "member"] as const) {
      await expectAiDisabled(
        await world.as(role).post("/api/ai/filters/parse", { data }),
      );
      // The switch is checked before the body is read.
      await expectAiDisabled(
        await world
          .as(role)
          .post("/api/ai/filters/parse", { data: { ...ws(), text: "x" } }),
      );
    }
    // A viewer lacks ai:use: refused, but not by the AI switch.
    const viewer = await expectStatus(
      await world.as("viewer").post("/api/ai/filters/parse", { data }),
      403,
    );
    expect(viewer).not.toContain("AI_DISABLED");
    await expectStatus(
      await outsider.ctx.post("/api/ai/filters/parse", { data }),
      403,
    );
    await expectStatus(
      await world.as("anonymous").post("/api/ai/filters/parse", { data }),
      401,
    );
  },
);
