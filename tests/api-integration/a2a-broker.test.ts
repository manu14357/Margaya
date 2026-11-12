import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetA2aCaches } from "../../apps/api/src/a2a/broker";
import { saveWorkspaceAiSettings } from "../../apps/api/src/ai/workspace-settings";
import { encodeScope } from "../../apps/api/src/api-key/scope";
import { settleAuditWrites } from "../../apps/api/src/audit-log/record";
import db, { schema } from "../../apps/api/src/database";
import {
  a2aTaskTable,
  aiRunTable,
  auditLogTable,
} from "../../apps/api/src/database/schema";
import { resetRateLimitMemory } from "../../apps/api/src/utils/rate-limit";
import { createApiKey } from "./helpers/api-keys";
import { mockAnonymousSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { draftScene } from "./helpers/drafts";
import { setIntakeEnabled } from "./helpers/intake";

// Margaya as an A2A server, end to end through the real app: the off
// switch, authentication, the task lifecycle per skill, and that every
// action keeps the caller's own permissions (scoped keys, restricted
// projects, other people's tasks).

type Scene = Awaited<ReturnType<typeof draftScene>>;
type Rpc = {
  result?: Record<string, unknown> & {
    task?: TaskJson;
    tasks?: TaskJson[];
  };
  error?: { code: number; message: string; data?: Record<string, unknown> };
};
type TaskJson = {
  id: string;
  contextId: string;
  status: { state: string; message?: { parts: Array<{ text: string }> } };
  artifacts?: Array<{ parts: Array<{ text?: string; data?: unknown }> }>;
  metadata: { skill: string };
};

beforeEach(async () => {
  await resetTestDatabase();
  resetRateLimitMemory();
  resetA2aCaches();
});

afterEach(() => {
  delete process.env.MARGAYA_AI_ENABLED;
  delete process.env.MARGAYA_AI_PROVIDER;
});

async function scene(options: { a2a?: boolean } = {}) {
  const s = await draftScene();
  if (options.a2a !== false) {
    await db
      .update(schema.workspaceTable)
      .set({ allowA2a: true })
      .where(eq(schema.workspaceTable.id, s.workspaceId));
  }
  const [workspace] = await db
    .select({ slug: schema.workspaceTable.slug })
    .from(schema.workspaceTable)
    .where(eq(schema.workspaceTable.id, s.workspaceId));
  return { s, slug: workspace?.slug ?? "" };
}

let rpcId = 0;
async function rpc(
  s: Scene,
  headers: Record<string, string>,
  method: string,
  params: Record<string, unknown> = {},
  extraHeaders: Record<string, string> = {},
): Promise<Rpc> {
  mockAnonymousSession();
  rpcId += 1;
  const response = await s.app.request("/api/a2a", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "a2a-version": "1.0",
      ...headers,
      ...extraHeaders,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: rpcId, method, params }),
  });
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as Rpc;
}

const send = (
  s: Scene,
  headers: Record<string, string>,
  data: Record<string, unknown>,
  text: string,
  extra: Record<string, unknown> = {},
) =>
  rpc(s, headers, "SendMessage", {
    message: {
      messageId: `m-${rpcId + 1}`,
      role: "ROLE_USER",
      parts: [{ text }, { data, mediaType: "application/json" }],
    },
    ...extra,
  });

describe("A2A agent card", () => {
  it("is not served until a workspace turns A2A on", async () => {
    const { s } = await scene({ a2a: false });
    expect((await s.app.request("/.well-known/agent-card.json")).status).toBe(
      404,
    );

    await db
      .update(schema.workspaceTable)
      .set({ allowA2a: true })
      .where(eq(schema.workspaceTable.id, s.workspaceId));
    resetA2aCaches();
    for (const path of [
      "/.well-known/agent-card.json",
      "/api/.well-known/agent-card.json",
    ]) {
      const response = await s.app.request(path);
      expect(response.status).toBe(200);
      const card = (await response.json()) as Record<string, unknown>;
      expect(card.supportedInterfaces).toEqual([
        {
          url: "http://localhost:1337/api/a2a",
          protocolBinding: "JSONRPC",
          protocolVersion: "1.0",
        },
      ]);
      // No workspace, project or person on the public card.
      expect(JSON.stringify(card)).not.toContain(s.workspaceId);
    }
  });

  it("lists the caller's A2A workspaces as tenants on the extended card", async () => {
    const { s, slug } = await scene();
    const mia = await createApiKey(s.mia);
    const card = await rpc(s, mia.headers, "GetExtendedAgentCard");
    expect(
      (
        (card.result?.supportedInterfaces ?? []) as Array<{ tenant: string }>
      ).map((i) => i.tenant),
    ).toEqual([slug]);

    const oz = await createApiKey(s.outsider);
    const refused = await rpc(s, oz.headers, "GetExtendedAgentCard");
    expect(refused.error?.code).toBe(-32600);
  });
});

describe("A2A authentication and negotiation", () => {
  it("answers 401 with the protected resource metadata without a credential", async () => {
    const { s } = await scene();
    mockAnonymousSession();
    const response = await s.app.request("/api/a2a", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ListTasks" }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      "/.well-known/oauth-protected-resource/api/a2a",
    );
  });

  it("refuses other protocol versions and unknown methods", async () => {
    const { s } = await scene();
    const mia = await createApiKey(s.mia);
    const old = await rpc(
      s,
      mia.headers,
      "ListTasks",
      {},
      {
        "a2a-version": "0.3",
      },
    );
    expect(old.error?.code).toBe(-32009);
    expect(old.error?.data).toEqual({ supportedVersions: ["1.0"] });
    expect((await rpc(s, mia.headers, "DoMagic")).error?.code).toBe(-32601);
    // Push configs are supported; one without a task is invalid.
    expect(
      (await rpc(s, mia.headers, "CreateTaskPushNotificationConfig")).error
        ?.code,
    ).toBe(-32602);
  });

  it("does nothing while the workspace has A2A off", async () => {
    const { s } = await scene({ a2a: false });
    const mia = await createApiKey(s.mia);
    const result = await send(
      s,
      mia.headers,
      { skill: "create_task", project: "web" },
      "Should not exist",
    );
    expect(result.error?.code).toBe(-32602);
    expect(await db.select().from(a2aTaskTable)).toHaveLength(0);
  });
});

describe("A2A task lifecycle", () => {
  it("creates a task as the key's owner and reads it back", async () => {
    const { s, slug } = await scene();
    const mia = await createApiKey(s.mia);
    const sent = await send(
      s,
      mia.headers,
      { skill: "create_task", project: "web", priority: "high" },
      "Fix the login redirect\nIt loops on Safari.",
      { tenant: slug },
    );
    const task = sent.result?.task as TaskJson;
    expect(sent.error).toBeUndefined();
    expect(task.status.state).toBe("TASK_STATE_COMPLETED");
    expect(task.metadata.skill).toBe("create_task");
    expect(task.artifacts?.[0]?.parts[0]?.text).toBe(
      "WEB-1 Fix the login redirect",
    );

    const [created] = await db
      .select()
      .from(schema.taskTable)
      .where(eq(schema.taskTable.projectId, s.web.project.id));
    expect(created).toMatchObject({
      title: "Fix the login redirect",
      description: "It loops on Safari.",
      priority: "high",
      createdBy: s.mia.id,
    });

    const got = await rpc(s, mia.headers, "GetTask", { id: task.id });
    expect((got.result as unknown as TaskJson).status.state).toBe(
      "TASK_STATE_COMPLETED",
    );

    // Audited as received over A2A, by Mia's key.
    await settleAuditWrites();
    const [entry] = await db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.action, "a2a.task_received"));
    expect(entry).toMatchObject({
      actorUserId: s.mia.id,
      apiKeyId: mia.id,
      targetId: task.id,
    });

    // Completed work can't be cancelled.
    const cancel = await rpc(s, mia.headers, "CancelTask", { id: task.id });
    expect(cancel.error?.code).toBe(-32002);
  });

  it("maps an intake request's triage onto the task state", async () => {
    const { s } = await scene();
    await setIntakeEnabled(s.web.project.id, true);
    const mia = await createApiKey(s.mia);
    const sent = await send(
      s,
      mia.headers,
      { project: "web" },
      "Customers can't export invoices",
    );
    const task = sent.result?.task as TaskJson;
    expect(task.status.state).toBe("TASK_STATE_SUBMITTED");
    expect(task.metadata.skill).toBe("triage_request");

    const [row] = await db
      .select()
      .from(a2aTaskTable)
      .where(eq(a2aTaskTable.id, task.id));
    await s.ok(s.ada, "POST", `/intake/item/${row?.refId}/accept`, {
      status: "to-do",
    });
    const accepted = await rpc(s, mia.headers, "GetTask", { id: task.id });
    const view = accepted.result as unknown as TaskJson;
    expect(view.status.state).toBe("TASK_STATE_COMPLETED");
    expect(view.artifacts?.[0]?.parts[0]?.text).toContain(
      "Customers can't export invoices",
    );

    const second = await send(s, mia.headers, { project: "web" }, "Dark mode");
    const secondTask = second.result?.task as TaskJson;
    const [secondRow] = await db
      .select()
      .from(a2aTaskTable)
      .where(eq(a2aTaskTable.id, secondTask.id));
    await s.ok(s.ada, "POST", `/intake/item/${secondRow?.refId}/decline`, {
      note: "Out of scope",
    });
    const declined = await rpc(s, mia.headers, "GetTask", {
      id: secondTask.id,
    });
    const declinedView = declined.result as unknown as TaskJson;
    expect(declinedView.status.state).toBe("TASK_STATE_REJECTED");
    expect(declinedView.status.message?.parts[0]?.text).toContain(
      "Out of scope",
    );

    const listed = await rpc(s, mia.headers, "ListTasks", { pageSize: 1 });
    expect(listed.result?.tasks).toHaveLength(1);
    expect(listed.result?.totalSize).toBe(2);
    expect(listed.result?.nextPageToken).not.toBe("");
    const next = await rpc(s, mia.headers, "ListTasks", {
      pageSize: 1,
      pageToken: listed.result?.nextPageToken,
    });
    expect(next.result?.tasks?.[0]?.id).not.toBe(listed.result?.tasks?.[0]?.id);
    expect(next.result?.nextPageToken).toBe("");
  });

  it("maps an agent run, including cancellation", async () => {
    process.env.MARGAYA_AI_ENABLED = "true";
    process.env.MARGAYA_AI_PROVIDER = "fake";
    const { s } = await scene();
    await saveWorkspaceAiSettings(s.workspaceId, { enabled: true }, s.owner.id);
    const bot = await s.ok<{ id: string }>(s.owner, "POST", "/ai/agents", {
      workspaceId: s.workspaceId,
      name: "Triage Bot",
    });
    const target = await s.ok<{ id: string }>(
      s.mia,
      "POST",
      `/task/${s.web.project.id}`,
      {
        title: "Tidy me",
        description: "",
        priority: "low",
        status: "to-do",
        assigneeIds: [],
      },
    );
    const mia = await createApiKey(s.mia);
    const sent = await send(
      s,
      mia.headers,
      { skill: "run_agent", agent: "triage bot", task: target.id },
      "Add a short summary comment",
      { configuration: { returnImmediately: true } },
    );
    const task = sent.result?.task as TaskJson;
    expect(sent.error).toBeUndefined();
    expect(task.status.state).toBe("TASK_STATE_SUBMITTED");

    const [row] = await db
      .select()
      .from(a2aTaskTable)
      .where(eq(a2aTaskTable.id, task.id));
    await db
      .update(aiRunTable)
      .set({ status: "running" })
      .where(eq(aiRunTable.id, row?.refId ?? ""));
    const working = await rpc(s, mia.headers, "GetTask", { id: task.id });
    expect((working.result as unknown as TaskJson).status.state).toBe(
      "TASK_STATE_WORKING",
    );

    const cancelled = await rpc(s, mia.headers, "CancelTask", { id: task.id });
    expect((cancelled.result as unknown as TaskJson).status.state).toBe(
      "TASK_STATE_CANCELED",
    );

    // A finished run reports its summary.
    const again = await send(
      s,
      mia.headers,
      { skill: "run_agent", agent: bot.id, task: target.id },
      "Try again",
      { configuration: { returnImmediately: true } },
    );
    const againTask = again.result?.task as TaskJson;
    const [againRow] = await db
      .select()
      .from(a2aTaskTable)
      .where(eq(a2aTaskTable.id, againTask.id));
    await db
      .update(aiRunTable)
      .set({ status: "succeeded", outputSummary: "Added a summary." })
      .where(eq(aiRunTable.id, againRow?.refId ?? ""));
    const done = await rpc(s, mia.headers, "GetTask", { id: againTask.id });
    const doneView = done.result as unknown as TaskJson;
    expect(doneView.status.state).toBe("TASK_STATE_COMPLETED");
    expect(doneView.artifacts?.[0]?.parts[0]?.text).toBe("Added a summary.");
  });

  it("streams a task over SSE", async () => {
    const { s } = await scene();
    const mia = await createApiKey(s.mia);
    mockAnonymousSession();
    const response = await s.app.request("/api/a2a", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "a2a-version": "1.0",
        ...mia.headers,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "SendStreamingMessage",
        params: {
          message: {
            messageId: "s1",
            role: "ROLE_USER",
            parts: [
              { text: "Streamed task" },
              { data: { skill: "create_task", project: "web" } },
            ],
          },
        },
      }),
    });
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const events = (await response.text())
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)));
    expect(events[0]).toMatchObject({
      jsonrpc: "2.0",
      id: 7,
      result: { task: { status: { state: "TASK_STATE_COMPLETED" } } },
    });
  });
});

describe("A2A authorization", () => {
  it("a read-only key can't create anything", async () => {
    const { s } = await scene();
    const readOnly = await createApiKey(
      s.mia,
      encodeScope({ access: "read" }) ?? undefined,
    );
    const result = await send(
      s,
      readOnly.headers,
      { skill: "create_task", project: "web" },
      "Not allowed",
    );
    expect(result.error?.code).toBe(-32600);
    expect(result.error?.data).toEqual({ httpStatus: 403 });
    expect(await db.select().from(a2aTaskTable)).toHaveLength(0);
    const tasks = await db
      .select()
      .from(schema.taskTable)
      .where(eq(schema.taskTable.title, "Not allowed"));
    expect(tasks).toHaveLength(0);
  });

  it("a viewer can't create tasks", async () => {
    const { s } = await scene();
    const vic = await createApiKey(s.vic);
    const result = await send(
      s,
      vic.headers,
      { skill: "create_task", project: "web" },
      "Viewer task",
    );
    expect(result.error?.data).toEqual({ httpStatus: 403 });
  });

  it("a restricted project the caller isn't in is not targetable", async () => {
    const { s } = await scene();
    await db
      .update(schema.projectTable)
      .set({ visibility: "restricted" })
      .where(eq(schema.projectTable.id, s.api.project.id));
    const mia = await createApiKey(s.mia);
    for (const project of ["api", s.api.project.id]) {
      const result = await send(
        s,
        mia.headers,
        { skill: "create_task", project },
        "Sneaky",
      );
      expect(result.error).toMatchObject({
        code: -32602,
        message: "Unknown project",
      });
    }
    // A key scoped to other projects can't target this one either.
    const scoped = await createApiKey(
      s.mia,
      encodeScope({ access: "full", projectIds: [s.api.project.id] }) ??
        undefined,
    );
    const viaScoped = await send(
      s,
      scoped.headers,
      { skill: "create_task", project: "web" },
      "Out of scope",
    );
    expect(viaScoped.error).toBeDefined();
    expect(await db.select().from(a2aTaskTable)).toHaveLength(0);
  });

  it("people only see their own A2A tasks, and outsiders no tenant", async () => {
    const { s, slug } = await scene();
    const mia = await createApiKey(s.mia);
    const sent = await send(
      s,
      mia.headers,
      { skill: "create_task", project: "web" },
      "Mine",
    );
    const id = sent.result?.task?.id ?? "";

    const owen = await createApiKey(s.owner);
    expect((await rpc(s, owen.headers, "GetTask", { id })).error?.code).toBe(
      -32001,
    );
    expect(
      (await rpc(s, owen.headers, "ListTasks")).result?.tasks,
    ).toHaveLength(0);

    const oz = await createApiKey(s.outsider);
    const foreign = await rpc(s, oz.headers, "GetTask", { id, tenant: slug });
    expect(foreign.error?.code).toBe(-32602);
  });
});
