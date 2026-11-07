import type { APIRequestContext, APIResponse } from "@playwright/test";
import { expect, test } from "../../fixtures";
import {
  createProject,
  createTask,
  createWorld,
  expectJson,
  expectStatus,
  type Project,
  signUpUser,
  type Task,
  type TestUser,
  type World,
} from "../../helpers/api-kit";
import { covers } from "../../helpers/openapi";
import { uniqueName } from "../../helpers/ui";

// Ask conversations kept on the server, chat build mode (plan, apply, undo)
// and the smaller AI helpers (speech, page title and blocks, draft labels,
// inbox digest) on an instance where AI is off. Server history needs no
// model: once this file's workspace opts in (storeConversations), the whole
// CRUD runs for real, owner-only. Every generation route answers 403
// AI_DISABLED after access and ai:use; undo needs no AI switch and answers
// for unknown tokens. Workspace settings are restored before the file ends.

type Turn = {
  question: string;
  answer: string;
  sources?: Record<string, unknown>[];
  citations?: string[];
  createdAt?: string;
  [extra: string]: unknown;
};

type Conversation = {
  id: string;
  title: string;
  projectId: string | null;
  pinned: boolean;
  turns: Turn[];
  createdAt: string;
  updatedAt: string;
};

type Summary = Omit<Conversation, "turns"> & { turnCount: number };

const MISSING = "e2e-missing-id";
const AI_DISABLED = {
  code: "AI_DISABLED",
  message: "AI is turned off on this server",
};
const HISTORY_OFF = {
  code: "AI_HISTORY_OFF",
  message: "This workspace doesn't keep AI conversations on the server",
};

let world: World;
let outsider: TestUser;
let project: Project;
let task: Task;
let pageId: string;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  world = await createWorld("AI chat");
  outsider = await signUpUser("AI chat outsider");
  project = await createProject(world.as("owner"), world.workspace.id);
  task = await createTask(world.as("owner"), project.id);
  const page = await expectJson<{ id: string }>(
    await world.as("member").post(`/api/page/project/${project.id}`, {
      data: {
        title: uniqueName("AI page"),
        content: "# Launch\n\nShip the beta on Friday.",
      },
    }),
  );
  pageId = page.id;
});

test.afterAll(async () => {
  // Leave this workspace's server history off whatever happened above.
  await world
    ?.as("owner")
    .patch("/api/ai/settings", {
      data: { workspaceId: world.workspace.id, storeConversations: false },
    })
    .catch(() => undefined);
  await outsider?.ctx.dispose();
  await world?.dispose();
});

const ws = () => ({ workspaceId: world.workspace.id });

/** A client-chosen conversation id (8 to 64 of A-Z a-z 0-9 _ -). */
function conversationId() {
  return `e2e-conv-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

const conversationUrl = (id: string) =>
  `/api/ai/conversations/${id}?workspaceId=${world.workspace.id}`;

async function setHistory(on: boolean) {
  const settings = await expectJson<{
    workspace: { storeConversations: boolean };
  }>(
    await world.as("admin").patch("/api/ai/settings", {
      data: { ...ws(), storeConversations: on },
    }),
  );
  expect(settings.workspace.storeConversations).toBe(on);
}

async function listAs(ctx: APIRequestContext): Promise<Summary[]> {
  const body = await expectJson<{ conversations: Summary[] }>(
    await ctx.get("/api/ai/conversations", { params: ws() }),
  );
  return body.conversations;
}

/** A JSON error body ({ code, message }) with this status. */
async function expectCode(
  response: APIResponse,
  status: number,
  body: { code: string; message: string },
) {
  const text = await expectStatus(response, status);
  expect(JSON.parse(text), response.url()).toEqual(body);
}

/** A plain-text refusal that is not the AI guard (e.g. no ai:use). */
async function expectPlain403(response: APIResponse) {
  const text = await expectStatus(response, 403);
  expect(text, response.url()).not.toContain("AI_DISABLED");
  expect(text, response.url()).not.toContain("AI_HISTORY_OFF");
}

test(
  "conversations answer AI_HISTORY_OFF until the workspace keeps them",
  covers(
    "listAiConversations",
    "getAiConversation",
    "putAiConversation",
    "updateAiConversation",
    "deleteAiConversation",
  ),
  async () => {
    const member = world.as("member");
    const id = conversationId();
    const requests = () => [
      member.get("/api/ai/conversations", { params: ws() }),
      member.get(conversationUrl(id)),
      member.put(`/api/ai/conversations/${id}`, {
        data: { ...ws(), title: "Off", turns: [] },
      }),
      member.patch(conversationUrl(id), { data: { pinned: true } }),
      member.delete(conversationUrl(id)),
    ];
    for (const request of requests()) {
      await expectCode(await request, 403, HISTORY_OFF);
    }

    const availability = await expectJson<{
      features: { storeConversations: boolean };
    }>(await member.get("/api/ai/availability", { params: ws() }));
    expect(availability.features.storeConversations).toBe(false);

    // Only ai:manage opts the workspace in.
    await expectStatus(
      await member.patch("/api/ai/settings", {
        data: { ...ws(), storeConversations: true },
      }),
      403,
    );
    await setHistory(true);
    expect(
      (
        await expectJson<{ features: { storeConversations: boolean } }>(
          await member.get("/api/ai/availability", { params: ws() }),
        )
      ).features.storeConversations,
    ).toBe(true);
    // Nothing was written while history was off.
    expect(await listAs(member)).toEqual([]);
    expect(
      await expectStatus(await member.get(conversationUrl(id)), 404),
    ).toContain("Conversation not found");
  },
);

test(
  "save, list, read, replace, rename, pin and delete my own conversation",
  covers(
    "listAiConversations",
    "getAiConversation",
    "putAiConversation",
    "updateAiConversation",
    "deleteAiConversation",
  ),
  async () => {
    const member = world.as("member");
    const id = conversationId();
    const firstTurn: Turn = {
      question: "What is due this week?",
      answer: `Only ${task.title} is open.`,
      sources: [{ kind: "task", id: task.id }],
      citations: [task.id],
      createdAt: "2030-01-01T09:00:00.000Z",
      // Fields beyond the documented ones are stored as sent.
      mode: "ask",
    };

    const created = await expectJson<Conversation>(
      await member.put(`/api/ai/conversations/${id}`, {
        data: {
          ...ws(),
          title: "  Due this week  ",
          projectId: project.id,
          turns: [firstTurn],
        },
      }),
    );
    expect(created).toMatchObject({
      id,
      title: "Due this week",
      projectId: project.id,
      pinned: false,
      turns: [firstTurn],
    });
    expect(Date.parse(created.createdAt)).not.toBeNaN();

    // A second one, in a project nobody can see: the project is dropped.
    const otherId = conversationId();
    const other = await expectJson<Conversation>(
      await member.put(`/api/ai/conversations/${otherId}`, {
        data: {
          ...ws(),
          title: "Elsewhere",
          projectId: MISSING,
          pinned: true,
          turns: [],
        },
      }),
    );
    expect(other).toMatchObject({ projectId: null, pinned: true, turns: [] });

    // Pinned first, then the most recently updated.
    let list = await listAs(member);
    expect(list.map((entry) => entry.id)).toEqual([otherId, id]);
    expect(list[1]).toMatchObject({
      id,
      title: "Due this week",
      projectId: project.id,
      pinned: false,
      turnCount: 1,
    });
    expect(list[1]).not.toHaveProperty("turns");

    expect(
      await expectJson<Conversation>(await member.get(conversationUrl(id))),
    ).toEqual(created);

    // PUT again replaces title and turns; an omitted projectId and pin keep
    // their values.
    const secondTurn: Turn = {
      question: "And next week?",
      answer: "Nothing yet.",
    };
    const replaced = await expectJson<Conversation>(
      await member.put(`/api/ai/conversations/${id}`, {
        data: { ...ws(), title: "Two weeks", turns: [firstTurn, secondTurn] },
      }),
    );
    expect(replaced).toMatchObject({
      id,
      title: "Two weeks",
      projectId: project.id,
      pinned: false,
      turns: [firstTurn, secondTurn],
      createdAt: created.createdAt,
    });

    // Rename and pin; an empty patch changes nothing.
    const renamed = await expectJson<Summary>(
      await member.patch(conversationUrl(id), {
        data: { title: "Sprint questions", pinned: true },
      }),
    );
    expect(renamed).toMatchObject({
      id,
      title: "Sprint questions",
      pinned: true,
      projectId: project.id,
      turnCount: 2,
    });
    expect(
      await expectJson<Summary>(
        await member.patch(conversationUrl(id), { data: {} }),
      ),
    ).toMatchObject({ title: "Sprint questions", pinned: true, turnCount: 2 });
    list = await listAs(member);
    expect(
      list.filter((entry) => entry.pinned).map((entry) => entry.id),
    ).toEqual(expect.arrayContaining([id, otherId]));
    const unpinned = await expectJson<Summary>(
      await member.patch(conversationUrl(otherId), { data: { pinned: false } }),
    );
    expect(unpinned.pinned).toBe(false);
    expect((await listAs(member)).map((entry) => entry.id)).toEqual([
      id,
      otherId,
    ]);

    // Delete, then it reads as missing everywhere.
    expect(
      await expectJson(await member.delete(conversationUrl(otherId))),
    ).toEqual({ id: otherId });
    for (const request of [
      member.get(conversationUrl(otherId)),
      member.patch(conversationUrl(otherId), { data: { pinned: true } }),
      member.delete(conversationUrl(otherId)),
    ]) {
      expect(await expectStatus(await request, 404)).toContain(
        "Conversation not found",
      );
    }
    expect((await listAs(member)).map((entry) => entry.id)).toEqual([id]);

    expect(await expectJson(await member.delete(conversationUrl(id)))).toEqual({
      id,
    });
    expect(await listAs(member)).toEqual([]);
  },
);

test(
  "conversations belong to their owner: others read them as missing",
  covers(
    "listAiConversations",
    "getAiConversation",
    "putAiConversation",
    "updateAiConversation",
    "deleteAiConversation",
  ),
  async () => {
    const member = world.as("member");
    const admin = world.as("admin");
    const id = conversationId();
    const mine = await expectJson<Conversation>(
      await member.put(`/api/ai/conversations/${id}`, {
        data: {
          ...ws(),
          title: "Private thoughts",
          turns: [{ question: "Q", answer: "A" }],
        },
      }),
    );

    // Another member of the same workspace, even an admin, can't see,
    // overwrite, rename or delete it.
    expect(await listAs(admin)).toEqual([]);
    for (const request of [
      admin.get(conversationUrl(id)),
      admin.put(`/api/ai/conversations/${id}`, {
        data: { ...ws(), title: "Taken over", turns: [] },
      }),
      admin.patch(conversationUrl(id), { data: { title: "Renamed" } }),
      admin.delete(conversationUrl(id)),
    ]) {
      expect(await expectStatus(await request, 404)).toContain(
        "Conversation not found",
      );
    }
    expect(
      await expectJson<Conversation>(await member.get(conversationUrl(id))),
    ).toEqual(mine);

    // A viewer has no ai:use; outsiders have no workspace; anonymous no session.
    for (const request of [
      world.as("viewer").get("/api/ai/conversations", { params: ws() }),
      world.as("viewer").get(conversationUrl(id)),
      world.as("viewer").put(`/api/ai/conversations/${conversationId()}`, {
        data: { ...ws(), title: "Viewer", turns: [] },
      }),
    ]) {
      await expectPlain403(await request);
    }
    await expectStatus(
      await outsider.ctx.get("/api/ai/conversations", { params: ws() }),
      403,
    );
    await expectStatus(await outsider.ctx.get(conversationUrl(id)), 403);
    await expectStatus(
      await world
        .as("anonymous")
        .get("/api/ai/conversations", { params: ws() }),
      401,
    );
    await expectStatus(
      await world.as("anonymous").delete(conversationUrl(id)),
      401,
    );
    expect((await listAs(member)).map((entry) => entry.id)).toEqual([id]);

    // Unknown ids answer 404 for the owner too.
    const unknown = conversationId();
    for (const request of [
      member.get(conversationUrl(unknown)),
      member.patch(conversationUrl(unknown), { data: { pinned: true } }),
      member.delete(conversationUrl(unknown)),
    ]) {
      expect(await expectStatus(await request, 404)).toContain(
        "Conversation not found",
      );
    }
    await expectJson(await member.delete(conversationUrl(id)));
  },
);

test(
  "conversation input is validated and bounded",
  covers("putAiConversation", "updateAiConversation"),
  async () => {
    const member = world.as("member");
    const id = conversationId();
    const put = (data: Record<string, unknown>, target = id) =>
      member.put(`/api/ai/conversations/${target}`, {
        data: { ...ws(), ...data },
      });

    for (const data of [
      { title: "", turns: [] },
      { title: "x".repeat(201), turns: [] },
      { title: "No turns" },
      { title: "Bad turn", turns: [{ question: "Only a question" }] },
      {
        title: "Too many",
        turns: Array.from({ length: 101 }, () => ({
          question: "q",
          answer: "a",
        })),
      },
      { title: "Extra", turns: [], reasoning: "never stored" },
    ]) {
      await expectStatus(await put(data), 400);
    }
    // The id is the client's: 8 to 64 of letters, digits, _ or -.
    for (const bad of ["short", "has.dots-in-it"]) {
      await expectStatus(await put({ title: "Bad id", turns: [] }, bad), 400);
    }
    // Every turn is valid, but together they pass 200 KB.
    const big = Array.from({ length: 4 }, (_, index) => ({
      question: `Part ${index}`,
      answer: "x".repeat(52_000),
    }));
    expect(
      await expectStatus(await put({ title: "Huge", turns: big }), 413),
    ).toMatch(/200 KB/);
    // Nothing above was stored.
    await expectStatus(await member.get(conversationUrl(id)), 404);

    await expectJson(await put({ title: "Valid", turns: [] }));
    for (const data of [
      { title: "" },
      { pinned: "yes" },
      { title: "Fine", turns: [] },
    ]) {
      await expectStatus(
        await member.patch(conversationUrl(id), { data }),
        400,
      );
    }
    expect(
      (await expectJson<Conversation>(await member.get(conversationUrl(id))))
        .title,
    ).toBe("Valid");
    await expectJson(await member.delete(conversationUrl(id)));
  },
);

test(
  "turning history off hides stored conversations without deleting them",
  covers("listAiConversations", "getAiConversation"),
  async () => {
    const member = world.as("member");
    const id = conversationId();
    await expectJson(
      await member.put(`/api/ai/conversations/${id}`, {
        data: { ...ws(), title: "Kept", turns: [] },
      }),
    );
    await setHistory(false);
    await expectCode(
      await member.get("/api/ai/conversations", { params: ws() }),
      403,
      HISTORY_OFF,
    );
    await expectCode(await member.get(conversationUrl(id)), 403, HISTORY_OFF);

    await setHistory(true);
    expect(
      await expectJson<Conversation>(await member.get(conversationUrl(id))),
    ).toMatchObject({ id, title: "Kept" });
    await expectJson(await member.delete(conversationUrl(id)));
    await setHistory(false);
  },
);

test(
  "chat build: plan and apply answer AI_DISABLED after access and ai:use",
  covers("aiChatBuildPlan", "aiChatBuildApply"),
  async () => {
    const workspaceId = world.workspace.id;
    const projectName = uniqueName("Chat built project");
    const plan = {
      workspaceId,
      projectId: project.id,
      prompt: `Create a project ${projectName} with two tasks`,
      history: [{ question: "Hi", answer: "Hello" }],
      context: [{ kind: "task", id: task.id }],
    };
    const apply = {
      workspaceId,
      actions: [
        {
          id: "a1",
          op: "create_project",
          title: `Create project ${projectName}`,
          risk: "write",
          refs: { tempId: "p1" },
          params: { name: projectName, key: "CHB" },
        },
        {
          id: "a2",
          op: "create_task",
          title: "Create a task",
          risk: "write",
          params: { projectRef: "p1", title: "First task" },
        },
      ],
    };
    const member = world.as("member");

    await expectCode(
      await member.post("/api/ai/chat/plan", { data: plan }),
      403,
      AI_DISABLED,
    );
    // Asking for the stream changes nothing: the guard answers before it.
    await expectCode(
      await member.post("/api/ai/chat/plan", {
        data: { ...plan, autopilot: true },
        headers: { accept: "text/event-stream" },
      }),
      403,
      AI_DISABLED,
    );
    await expectCode(
      await member.post("/api/ai/chat/apply", { data: apply }),
      403,
      AI_DISABLED,
    );

    for (const [path, data] of [
      ["/api/ai/chat/plan", plan],
      ["/api/ai/chat/apply", apply],
    ] as const) {
      await expectPlain403(await world.as("viewer").post(path, { data }));
      await expectStatus(await outsider.ctx.post(path, { data }), 403);
      await expectStatus(await world.as("anonymous").post(path, { data }), 401);
      // No workspace to resolve: refused before the AI switch.
      expect(
        await expectStatus(
          await member.post(path, { data: { prompt: "No workspace" } }),
          400,
        ),
      ).toContain("Workspace ID could not be determined");
    }

    // The refused apply created nothing.
    const projects = await expectJson<{ name: string }[]>(
      await world.as("owner").get("/api/project", { params: { workspaceId } }),
    );
    expect(projects.map((entry) => entry.name)).not.toContain(projectName);
  },
);

test(
  "chat build: undo needs no AI switch and refuses unknown tokens",
  covers("aiChatBuildUndo"),
  async () => {
    const workspaceId = world.workspace.id;
    // Undo runs without a model, but its token is sealed by the server on
    // apply, which needs AI on. Any other token reads as unknown.
    for (const actor of ["member", "viewer", "owner"] as const) {
      expect(
        await expectStatus(
          await world.as(actor).post("/api/ai/chat/undo", {
            data: { workspaceId, undoToken: "not-a-sealed-token" },
          }),
          404,
        ),
      ).toContain("Nothing to undo");
    }
    expect(
      await expectStatus(
        await world.as("member").post("/api/ai/chat/undo", {
          data: { workspaceId, undoToken: `v1.${"A".repeat(400)}` },
        }),
        404,
      ),
    ).toContain("Nothing to undo");

    for (const data of [
      { workspaceId },
      { workspaceId, undoToken: "" },
      { workspaceId, undoToken: 42 },
    ]) {
      await expectStatus(
        await world.as("member").post("/api/ai/chat/undo", { data }),
        400,
      );
    }
    const data = { workspaceId, undoToken: "not-a-sealed-token" };
    await expectStatus(
      await outsider.ctx.post("/api/ai/chat/undo", { data }),
      403,
    );
    await expectStatus(
      await world.as("anonymous").post("/api/ai/chat/undo", { data }),
      401,
    );
  },
);

test(
  "build with AI: undo needs no AI switch and refuses unknown tokens",
  covers("aiBuildUndo"),
  async () => {
    const workspaceId = world.workspace.id;
    const data = { workspaceId, undoToken: "not-a-sealed-token" };
    // Its token is sealed by the server on apply, which needs AI on. Any other
    // token reads as unknown.
    for (const actor of ["member", "viewer", "owner"] as const) {
      expect(
        await expectStatus(
          await world.as(actor).post("/api/ai/build/undo", { data }),
          404,
        ),
      ).toContain("Nothing to undo");
    }
    for (const invalid of [
      { workspaceId },
      { workspaceId, undoToken: "" },
      { workspaceId, undoToken: 42 },
    ]) {
      await expectStatus(
        await world.as("member").post("/api/ai/build/undo", { data: invalid }),
        400,
      );
    }
    await expectStatus(
      await outsider.ctx.post("/api/ai/build/undo", { data }),
      403,
    );
    await expectStatus(
      await world.as("anonymous").post("/api/ai/build/undo", { data }),
      401,
    );
  },
);

test(
  "speech, page title and blocks, draft labels and inbox digest answer AI_DISABLED",
  covers(
    "transcribeSpeech",
    "aiPageTitle",
    "aiPageBlock",
    "aiTriageDraftLabels",
    "aiInboxDigest",
  ),
  async () => {
    const workspaceId = world.workspace.id;
    const member = world.as("member");
    const audio = {
      name: "note.webm",
      mimeType: "audio/webm",
      buffer: Buffer.from("e2e not really audio"),
    };
    const transcribe = (
      ctx: APIRequestContext,
      query = `workspaceId=${workspaceId}`,
    ) =>
      ctx.post(`/api/ai/speech/transcribe?${query}&language=de`, {
        multipart: { audio },
      });

    const calls: { path: string; data: Record<string, unknown> }[] = [
      {
        path: "/api/ai/writing/title",
        data: { workspaceId, pageId, text: "Ship the beta on Friday." },
      },
      {
        path: "/api/ai/writing/page-block",
        data: { workspaceId, pageId, preset: "tldr", locale: "de-DE" },
      },
      {
        path: "/api/ai/writing/page-block",
        data: {
          workspaceId,
          pageId,
          preset: "custom",
          instruction: "List the risks",
        },
      },
      {
        path: "/api/ai/triage/labels",
        data: {
          projectId: project.id,
          title: "Login page is blank",
          description: "After the last deploy",
        },
      },
      { path: "/api/ai/insight/inbox-digest", data: { workspaceId } },
    ];

    await expectCode(await transcribe(member), 403, AI_DISABLED);
    for (const { path, data } of calls) {
      await expectCode(await member.post(path, { data }), 403, AI_DISABLED);
    }

    // A viewer lacks ai:use (and task:create): refused before the switch.
    await expectPlain403(await transcribe(world.as("viewer")));
    for (const { path, data } of calls) {
      await expectPlain403(await world.as("viewer").post(path, { data }));
      await expectStatus(await outsider.ctx.post(path, { data }), [403, 404]);
      await expectStatus(await world.as("anonymous").post(path, { data }), 401);
    }
    await expectStatus(await transcribe(outsider.ctx), 403);
    await expectStatus(await transcribe(world.as("anonymous")), 401);

    // The workspace comes from the query: without it, nothing to resolve.
    expect(await expectStatus(await transcribe(member, "x=1"), 400)).toContain(
      "Workspace ID could not be determined",
    );
    // Draft labels resolve the workspace from the project.
    expect(
      await expectStatus(
        await member.post("/api/ai/triage/labels", {
          data: { projectId: MISSING, title: "Login page is blank" },
        }),
        404,
      ),
    ).toContain("Project not found");
  },
);
