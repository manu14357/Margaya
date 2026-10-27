import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "../../fixtures";
import {
  createProject,
  createTask,
  createWorld,
  expectJson,
  expectStatus,
  signUpUser,
  type TestUser,
  type World,
} from "../../helpers/api-kit";
import { covers } from "../../helpers/openapi";
import type { ReceivedRequest, WebhookSink } from "../../helpers/webhook-sink";

// AI agents and the coding-agent handoff. AI is off on the e2e instance, so
// agent runs answer the AI_DISABLED guard and the Agent Desk (runs, approvals,
// undo) is checked through its empty lists and unknown ids; agent identity
// and coding-agent profiles work without AI. The handoff sends a real issue to
// a fake Gitea served by the webhook sink.

type Agent = {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  image: string | null;
  role: string | null;
  enabled: boolean;
  modelTier: "fast" | "balanced" | "deep";
  providerOverride: "local" | null;
  instructions: string | null;
  monthlyBudgetMicros: number | null;
  monthSpendMicros: number | null;
  ownerId: string | null;
};

type Profile = {
  id: string;
  builtin: "claude_code" | "copilot" | "codex" | null;
  name: string;
  mention: string;
  assignee: string | null;
  enabled: boolean;
  providers: ("github" | "gitea")[];
};

type Handoff = {
  id: string;
  provider: "github" | "gitea";
  profileName: string;
  issueNumber: number;
  issueUrl: string;
  prNumber: number | null;
  state: string;
  sentBy: { id: string; name: string } | null;
};

const UNKNOWN = "e2e-unknown-id";

let world: World;
let outsider: TestUser;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  world = await createWorld("Agents");
  outsider = await signUpUser("Agents outsider");
});

test.afterAll(async () => {
  await outsider?.ctx.dispose();
  await world?.dispose();
});

const agentsUrl = () => `/api/ai/agents?workspaceId=${world.workspace.id}`;

async function listAgentsAs(ctx: APIRequestContext) {
  return expectJson<Agent[]>(await ctx.get(agentsUrl()));
}

/** The JSON error body of the AI guard ({ code, message }). */
async function expectAiDisabled(
  response: Awaited<ReturnType<APIRequestContext["get"]>>,
) {
  const text = await expectStatus(response, 403);
  expect(JSON.parse(text)).toMatchObject({ code: "AI_DISABLED" });
}

test(
  "agents: create, list with and without ai:manage, update and delete",
  covers("listAgents", "createAgent", "updateAgent", "deleteAgent"),
  async () => {
    const owner = world.as("owner");
    const workspaceId = world.workspace.id;
    expect(await listAgentsAs(owner)).toEqual([]);

    // Authorization: ai:manage to create, signed-in member to list.
    await expectStatus(
      await world.as("member").post("/api/ai/agents", {
        data: { workspaceId, name: "Member's agent" },
      }),
      403,
    );
    await expectStatus(await world.as("anonymous").get(agentsUrl()), 401);
    await expectStatus(await outsider.ctx.get(agentsUrl()), 403);

    // Never an owner or admin, never an unknown role, no unknown fields.
    for (const role of ["admin", "owner"]) {
      expect(
        await expectStatus(
          await owner.post("/api/ai/agents", {
            data: { workspaceId, name: "Bossy", role },
          }),
          400,
        ),
      ).toContain("Agents can't be owners or admins");
    }
    expect(
      await expectStatus(
        await owner.post("/api/ai/agents", {
          data: { workspaceId, name: "Odd", role: "no-such-role" },
        }),
        400,
      ),
    ).toContain("Unknown role");
    await expectStatus(
      await owner.post("/api/ai/agents", {
        data: { workspaceId, name: "Extra", password: "nope" },
      }),
      400,
    );
    await expectStatus(
      await owner.post("/api/ai/agents", {
        data: { workspaceId, name: "Tier", modelTier: "huge" },
      }),
      400,
    );

    const created = await expectJson<Agent>(
      await owner.post("/api/ai/agents", {
        data: {
          workspaceId,
          name: "  Triage Bot  ",
          description: "Sorts incoming work",
          instructions: "Label and prioritise new tasks.",
          modelTier: "fast",
          role: "viewer",
          monthlyBudgetMicros: 5_000_000,
        },
      }),
    );
    expect(created).toMatchObject({
      name: "Triage Bot",
      description: "Sorts incoming work",
      instructions: "Label and prioritise new tasks.",
      modelTier: "fast",
      providerOverride: null,
      role: "viewer",
      enabled: true,
      monthlyBudgetMicros: 5_000_000,
      monthSpendMicros: 0,
      ownerId: world.users.owner.id,
    });
    expect(created.id).toBeTruthy();
    expect(created.userId).toBeTruthy();
    expect(created.userId).not.toBe(created.id);

    try {
      // Managers see the configuration; members only who is an agent.
      const forAdmin = await listAgentsAs(world.as("admin"));
      expect(forAdmin).toEqual([
        expect.objectContaining({
          id: created.id,
          instructions: "Label and prioritise new tasks.",
          monthlyBudgetMicros: 5_000_000,
          monthSpendMicros: 0,
        }),
      ]);
      const forMember = await listAgentsAs(world.as("member"));
      expect(forMember).toEqual([
        expect.objectContaining({
          id: created.id,
          userId: created.userId,
          name: "Triage Bot",
          role: "viewer",
          instructions: null,
          monthlyBudgetMicros: null,
          monthSpendMicros: null,
        }),
      ]);
      await expectJson(await world.as("viewer").get(agentsUrl()));

      // The agent is a workspace member with its role.
      const { members } = await expectJson<{
        members: { userId: string; role: string }[];
      }>(
        await owner.get("/api/auth/organization/list-members", {
          params: { organizationId: workspaceId },
        }),
      );
      expect(members).toContainEqual(
        expect.objectContaining({ userId: created.userId, role: "viewer" }),
      );

      // Update: name, role, budget and the off switch.
      const updateUrl = `/api/ai/agents/${created.id}`;
      await expectStatus(
        await world.as("member").patch(updateUrl, {
          data: { workspaceId, enabled: false },
        }),
        403,
      );
      await expectStatus(
        await owner.patch(`/api/ai/agents/${UNKNOWN}`, {
          data: { workspaceId, name: "Ghost" },
        }),
        404,
      );
      await expectStatus(
        await owner.patch(updateUrl, { data: { workspaceId, role: "admin" } }),
        400,
      );
      const updated = await expectJson<Agent>(
        await world.as("admin").patch(updateUrl, {
          data: {
            workspaceId,
            name: "Sorting Bot",
            role: "member",
            enabled: false,
            monthlyBudgetMicros: null,
            description: null,
            providerOverride: "local",
          },
        }),
      );
      expect(updated).toMatchObject({
        id: created.id,
        name: "Sorting Bot",
        role: "member",
        enabled: false,
        monthlyBudgetMicros: null,
        description: null,
        providerOverride: "local",
        instructions: "Label and prioritise new tasks.",
      });
      expect(await listAgentsAs(world.as("member"))).toEqual([
        expect.objectContaining({
          id: created.id,
          name: "Sorting Bot",
          enabled: false,
          role: "member",
        }),
      ]);

      // Turn it back on (reverse state).
      expect(
        (
          await expectJson<Agent>(
            await owner.patch(updateUrl, {
              data: { workspaceId, enabled: true },
            }),
          )
        ).enabled,
      ).toBe(true);
    } finally {
      const deleteUrl = `/api/ai/agents/${created.id}?workspaceId=${workspaceId}`;
      await expectStatus(await world.as("member").delete(deleteUrl), 403);
      expect(await expectJson(await owner.delete(deleteUrl))).toEqual({
        id: created.id,
      });
    }
    await expectStatus(
      await owner.delete(
        `/api/ai/agents/${created.id}?workspaceId=${workspaceId}`,
      ),
      404,
    );
    expect(await listAgentsAs(owner)).toEqual([]);
  },
);

test(
  "agent runs, approvals and undo: AI guard, empty desk and unknown ids",
  covers(
    "startAgentRun",
    "listAgentRuns",
    "getAgentRun",
    "cancelAgentRun",
    "undoAgentChange",
    "listAgentApprovals",
    "approveAgentChange",
    "rejectAgentChange",
  ),
  async () => {
    const owner = world.as("owner");
    const workspaceId = world.workspace.id;
    const project = await createProject(owner, workspaceId);
    const task = await createTask(owner, project.id);
    const agent = await expectJson<Agent>(
      await owner.post("/api/ai/agents", {
        data: { workspaceId, name: "Runner Bot" },
      }),
    );
    try {
      // Starting a run needs AI on: the instance has it off.
      const runUrl = `/api/ai/agents/${agent.id}/runs`;
      const runBody = { workspaceId, taskId: task.id, prompt: "Summarise" };
      await expectAiDisabled(await owner.post(runUrl, { data: runBody }));
      await expectAiDisabled(
        await world.as("member").post(runUrl, { data: runBody }),
      );
      // Viewers lack ai:use, which is checked before the AI switch.
      const viewerText = await expectStatus(
        await world.as("viewer").post(runUrl, { data: runBody }),
        403,
      );
      expect(viewerText).not.toContain("AI_DISABLED");
      await expectStatus(
        await world.as("anonymous").post(runUrl, { data: runBody }),
        401,
      );

      // The Agent Desk is empty: nothing could run.
      const runsUrl = `/api/ai/agents/runs?workspaceId=${workspaceId}`;
      expect(await expectJson(await owner.get(runsUrl))).toEqual([]);
      expect(
        await expectJson(
          await world
            .as("member")
            .get(
              `${runsUrl}&agentId=${agent.id}&taskId=${task.id}&status=queued&limit=5`,
            ),
        ),
      ).toEqual([]);
      await expectStatus(await owner.get(`${runsUrl}&status=sleeping`), 400);
      await expectStatus(await owner.get(`${runsUrl}&limit=500`), 400);
      await expectStatus(await world.as("viewer").get(runsUrl), 403);
      await expectStatus(await world.as("anonymous").get(runsUrl), 401);
      await expectStatus(await outsider.ctx.get(runsUrl), 403);

      expect(
        await expectStatus(
          await owner.get(
            `/api/ai/agents/runs/${UNKNOWN}?workspaceId=${workspaceId}`,
          ),
          404,
        ),
      ).toContain("Run not found");
      await expectStatus(
        await world
          .as("viewer")
          .get(`/api/ai/agents/runs/${UNKNOWN}?workspaceId=${workspaceId}`),
        403,
      );

      const body = { data: { workspaceId } };
      expect(
        await expectStatus(
          await owner.post(`/api/ai/agents/runs/${UNKNOWN}/cancel`, body),
          404,
        ),
      ).toContain("Run not found");
      await expectStatus(
        await world
          .as("viewer")
          .post(`/api/ai/agents/runs/${UNKNOWN}/cancel`, body),
        403,
      );

      expect(
        await expectStatus(
          await owner.post(`/api/ai/agents/steps/${UNKNOWN}/undo`, body),
          404,
        ),
      ).toContain("Change not found");
      await expectStatus(
        await world
          .as("viewer")
          .post(`/api/ai/agents/steps/${UNKNOWN}/undo`, body),
        403,
      );

      const approvalsUrl = `/api/ai/agents/approvals?workspaceId=${workspaceId}`;
      expect(await expectJson(await owner.get(approvalsUrl))).toEqual([]);
      expect(
        await expectJson(await world.as("member").get(approvalsUrl)),
      ).toEqual([]);
      await expectStatus(await world.as("viewer").get(approvalsUrl), 403);
      await expectStatus(await world.as("anonymous").get(approvalsUrl), 401);

      for (const decision of ["approve", "reject"]) {
        const url = `/api/ai/agents/approvals/${UNKNOWN}/${decision}`;
        expect(await expectStatus(await owner.post(url, body), 404)).toContain(
          "Approval not found",
        );
        await expectStatus(await world.as("viewer").post(url, body), 403);
        await expectStatus(await outsider.ctx.post(url, body), 403);
      }
    } finally {
      await owner.delete(
        `/api/ai/agents/${agent.id}?workspaceId=${workspaceId}`,
      );
      await owner.delete(`/api/project/${project.id}`);
    }
  },
);

test(
  "coding agent profiles: built-ins, custom create, update and delete",
  covers(
    "listCodingAgentProfiles",
    "createCodingAgentProfile",
    "updateCodingAgentProfile",
    "deleteCodingAgentProfile",
  ),
  async () => {
    const owner = world.as("owner");
    const workspaceId = world.workspace.id;
    const listUrl = `/api/coding-agent/profiles?workspaceId=${workspaceId}`;

    const forMember = await expectJson<{
      profiles: Profile[];
      canManage: boolean;
    }>(await world.as("member").get(listUrl));
    expect(forMember.canManage).toBe(false);
    expect(forMember.profiles).toEqual([
      expect.objectContaining({
        builtin: "claude_code",
        mention: "@claude",
        assignee: null,
        enabled: true,
        providers: ["github", "gitea"],
      }),
      expect.objectContaining({
        builtin: "copilot",
        mention: "",
        assignee: "Copilot",
        enabled: true,
        providers: ["github"],
      }),
      expect.objectContaining({
        builtin: "codex",
        mention: "@codex",
        providers: ["github", "gitea"],
      }),
    ]);
    const forOwner = await expectJson<{ canManage: boolean }>(
      await owner.get(listUrl),
    );
    expect(forOwner.canManage).toBe(true);
    await expectStatus(await world.as("anonymous").get(listUrl), 401);
    await expectStatus(await outsider.ctx.get(listUrl), 403);

    // Creating needs workspace:manage_settings and a mention or assignee.
    await expectStatus(
      await world.as("member").post("/api/coding-agent/profiles", {
        data: { workspaceId, name: "Mine", mention: "@mine" },
      }),
      403,
    );
    expect(
      await expectStatus(
        await owner.post("/api/coding-agent/profiles", {
          data: { workspaceId, name: "Empty", mention: "  ", assignee: null },
        }),
        400,
      ),
    ).toContain("A profile needs a mention or an assignee");
    await expectStatus(
      await owner.post("/api/coding-agent/profiles", {
        data: { workspaceId, name: "Bad login", assignee: "not a login!" },
      }),
      400,
    );

    const custom = await expectJson<Profile>(
      await owner.post("/api/coding-agent/profiles", {
        data: {
          workspaceId,
          name: "  Review Bot  ",
          mention: "@review-bot work on {task} in {branch}",
        },
      }),
    );
    expect(custom).toMatchObject({
      builtin: null,
      name: "Review Bot",
      mention: "@review-bot work on {task} in {branch}",
      assignee: null,
      enabled: true,
      providers: ["github", "gitea"],
    });
    const assigneeOnly = await expectJson<Profile>(
      await world.as("admin").post("/api/coding-agent/profiles", {
        data: { workspaceId, name: "Assign bot", assignee: "e2e-bot[bot]" },
      }),
    );
    expect(assigneeOnly).toMatchObject({
      mention: "",
      assignee: "e2e-bot[bot]",
      providers: ["github"],
    });

    try {
      const listed = await expectJson<{ profiles: Profile[] }>(
        await owner.get(listUrl),
      );
      expect(listed.profiles.map((profile) => profile.id)).toEqual(
        expect.arrayContaining([custom.id, assigneeOnly.id]),
      );
      // Built-ins stay first.
      expect(listed.profiles.slice(0, 3).map((p) => p.builtin)).toEqual([
        "claude_code",
        "copilot",
        "codex",
      ]);

      const patchUrl = (id: string) =>
        `/api/coding-agent/profiles/${id}?workspaceId=${workspaceId}`;
      await expectStatus(
        await world.as("member").patch(patchUrl(custom.id), {
          data: { enabled: false },
        }),
        403,
      );
      await expectStatus(
        await owner.patch(patchUrl(UNKNOWN), { data: { enabled: false } }),
        404,
      );
      // Clearing the only mention leaves the profile unusable.
      expect(
        await expectStatus(
          await owner.patch(patchUrl(custom.id), { data: { mention: "" } }),
          400,
        ),
      ).toContain("A profile needs a mention or an assignee");
      await expectStatus(
        await owner.patch(patchUrl(custom.id), { data: { workspaceId } }),
        400,
      );

      const renamed = await expectJson<Profile>(
        await owner.patch(patchUrl(custom.id), {
          data: { name: "Review Bot 2", enabled: false, assignee: "Copilot" },
        }),
      );
      expect(renamed).toMatchObject({
        id: custom.id,
        name: "Review Bot 2",
        enabled: false,
        assignee: "Copilot",
        mention: "@review-bot work on {task} in {branch}",
      });
      const enabledAgain = await expectJson<Profile>(
        await owner.patch(patchUrl(custom.id), { data: { enabled: true } }),
      );
      expect(enabledAgain.enabled).toBe(true);

      // Built-ins can be turned off and on, never deleted.
      const claude = forMember.profiles[0] as Profile;
      expect(
        (
          await expectJson<Profile>(
            await owner.patch(patchUrl(claude.id), {
              data: { enabled: false },
            }),
          )
        ).enabled,
      ).toBe(false);
      expect(
        (
          await expectJson<Profile>(
            await owner.patch(patchUrl(claude.id), { data: { enabled: true } }),
          )
        ).enabled,
      ).toBe(true);
      expect(
        await expectStatus(await owner.delete(patchUrl(claude.id)), 400),
      ).toContain("Built-in profiles can be turned off but not deleted");

      await expectStatus(
        await world.as("member").delete(patchUrl(custom.id)),
        403,
      );
    } finally {
      for (const id of [custom.id, assigneeOnly.id]) {
        expect(
          await expectJson(
            await owner.delete(
              `/api/coding-agent/profiles/${id}?workspaceId=${workspaceId}`,
            ),
          ),
        ).toEqual({ id, deleted: true });
      }
    }
    await expectStatus(
      await owner.delete(
        `/api/coding-agent/profiles/${custom.id}?workspaceId=${workspaceId}`,
      ),
      404,
    );
    const after = await expectJson<{ profiles: Profile[] }>(
      await owner.get(listUrl),
    );
    expect(after.profiles.map((profile) => profile.builtin)).toEqual([
      "claude_code",
      "copilot",
      "codex",
    ]);
  },
);

/** A Gitea that knows one repository and accepts new issues as #42. */
function serveFakeGitea(sink: WebhookSink, options: { failIssues?: boolean }) {
  const html = `${sink.url}/e2e/agents`;
  sink.respondWith((request: ReceivedRequest) => {
    const json = (body: unknown, status = 200) => ({
      status,
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    });
    const pathname = request.path.split("?")[0] ?? "";
    if (request.headers.authorization !== "token e2e-gitea-token") {
      return json({ message: "token is required" }, 401);
    }
    if (pathname === "/api/v1/user") return json({ id: 1, login: "e2e-bot" });
    if (pathname === "/api/v1/repos/e2e/agents") {
      return json({
        name: "agents",
        owner: { login: "e2e" },
        html_url: html,
        private: false,
        permissions: { admin: true, push: true, pull: true },
      });
    }
    if (
      pathname === "/api/v1/repos/e2e/agents/issues" &&
      request.method === "POST"
    ) {
      if (options.failIssues) return json({ message: "boom" }, 500);
      return json(
        {
          id: 4200,
          number: 42,
          title: "issue",
          body: "",
          html_url: `${html}/issues/42`,
          state: "open",
        },
        201,
      );
    }
    if (request.method === "GET") return json([]);
    return json({ id: 1 }, 201);
  });
}

test(
  "coding agent handoff: task options, brief and send to a fake Gitea",
  covers("getTaskCodingAgents", "prepareCodingAgentBrief", "sendToCodingAgent"),
  async ({ webhookSink }) => {
    const owner = world.as("owner");
    const workspaceId = world.workspace.id;
    const project = await createProject(owner, workspaceId);
    // A credential-looking value that must never reach the issue.
    const secret = "ghp_e2eSecretToken0123456789abcdef";
    const task = await createTask(owner, project.id, {
      title: "Add the export button",
      description: `Export the board as CSV. Deploy with ${secret}.`,
    });
    const taskUrl = `/api/coding-agent/task/${task.id}`;
    const failing = { failIssues: false };
    serveFakeGitea(webhookSink, failing);
    try {
      // Unknown and foreign tasks read as missing.
      for (const [method, path] of [
        ["get", `/api/coding-agent/task/${UNKNOWN}`],
        ["post", `/api/coding-agent/task/${UNKNOWN}/brief`],
        ["post", `/api/coding-agent/task/${UNKNOWN}/send`],
      ] as const) {
        const response =
          method === "get"
            ? await owner.get(path)
            : await owner.post(path, {
                data: {
                  integrationId: "x",
                  profileId: "x",
                  title: "t",
                  brief: "b",
                },
              });
        expect(await expectStatus(response, 404)).toContain("Task not found");
      }
      await expectStatus(await outsider.ctx.get(taskUrl), 403);
      await expectStatus(await world.as("anonymous").get(taskUrl), 401);

      // No repository yet.
      const empty = await expectJson<{
        repositories: unknown[];
        profiles: Profile[];
        handoffs: unknown[];
        canSend: boolean;
      }>(await world.as("viewer").get(taskUrl));
      expect(empty).toMatchObject({
        repositories: [],
        handoffs: [],
        canSend: false,
      });
      expect(empty.profiles.map((profile) => profile.builtin)).toEqual([
        "claude_code",
        "copilot",
        "codex",
      ]);
      expect(
        (
          await expectJson<{ canSend: boolean }>(
            await world.as("member").get(taskUrl),
          )
        ).canSend,
      ).toBe(true);
      expect(
        await expectStatus(
          await owner.post(`${taskUrl}/brief`, {
            data: { integrationId: UNKNOWN },
          }),
          404,
        ),
      ).toContain("Repository not found");

      // Connect the fake Gitea repository.
      const integration = await expectJson<{ id: string }>(
        await owner.post(`/api/gitea-integration/project/${project.id}`, {
          data: {
            baseUrl: webhookSink.url,
            accessToken: "e2e-gitea-token",
            repositoryOwner: "e2e",
            repositoryName: "agents",
          },
        }),
      );
      try {
        const options = await expectJson<{
          repositories: {
            integrationId: string;
            provider: string;
            name: string;
            ready: boolean;
          }[];
        }>(await owner.get(taskUrl));
        expect(options.repositories).toEqual([
          {
            integrationId: integration.id,
            provider: "gitea",
            name: "e2e/agents",
            ready: true,
          },
        ]);
        expect(JSON.stringify(options)).not.toContain("e2e-gitea-token");

        // The brief: a fixed outline without AI, never with credentials.
        const briefUrl = `${taskUrl}/brief`;
        await expectStatus(
          await world.as("viewer").post(briefUrl, {
            data: { integrationId: integration.id },
          }),
          403,
        );
        await expectStatus(
          await owner.post(briefUrl, {
            data: { integrationId: integration.id, extra: true },
          }),
          400,
        );
        const brief = await expectJson<{
          title: string;
          brief: string;
          aiUsed: boolean;
          relatedTasks: number;
          linkedPages: number;
        }>(
          await world.as("member").post(briefUrl, {
            data: { integrationId: integration.id },
          }),
        );
        expect(brief).toMatchObject({
          title: `${project.slug.toUpperCase()}-${task.number}: Add the export button`,
          aiUsed: false,
          relatedTasks: 0,
          linkedPages: 0,
        });
        expect(brief.brief).toContain("Export the board as CSV");
        expect(brief.brief).not.toContain(secret);
        // Condensing through AI answers the AI guard.
        await expectAiDisabled(
          await owner.post(briefUrl, {
            data: { integrationId: integration.id, useAi: true },
          }),
        );

        // Sending: roles, profile fit and the issue itself.
        const sendUrl = `${taskUrl}/send`;
        const profiles = empty.profiles;
        const claude = profiles.find((p) => p.builtin === "claude_code");
        const copilot = profiles.find((p) => p.builtin === "copilot");
        const send = (profileId: string | undefined, extra = {}) => ({
          data: {
            integrationId: integration.id,
            profileId: profileId ?? "",
            title: brief.title,
            brief: `${brief.brief}\nToken: ${secret}`,
            ...extra,
          },
        });
        await expectStatus(
          await world.as("viewer").post(sendUrl, send(claude?.id)),
          403,
        );
        expect(
          await expectStatus(await owner.post(sendUrl, send(copilot?.id)), 400),
        ).toContain("does not work with this repository");
        await expectStatus(await owner.post(sendUrl, send(UNKNOWN)), 404);
        await expectStatus(
          await owner.post(sendUrl, send(claude?.id, { title: "" })),
          400,
        );

        // The forge refusing the issue is a 502 without its body.
        failing.failIssues = true;
        expect(
          await expectStatus(await owner.post(sendUrl, send(claude?.id)), 502),
        ).not.toContain("boom");
        failing.failIssues = false;

        webhookSink.clear();
        const sent = await expectJson<{
          handoff: Handoff;
          assigned: boolean | null;
        }>(await world.as("member").post(sendUrl, send(claude?.id)));
        expect(sent.assigned).toBeNull();
        expect(sent.handoff).toMatchObject({
          provider: "gitea",
          profileName: "Claude Code (GitHub Action)",
          issueNumber: 42,
          issueUrl: `${webhookSink.url}/e2e/agents/issues/42`,
          prNumber: null,
          state: "issue_created",
          sentBy: { id: world.users.member.id, name: world.users.member.name },
        });
        const issue = await webhookSink.waitForRequest(
          (request) =>
            request.method === "POST" &&
            request.path.startsWith("/api/v1/repos/e2e/agents/issues"),
        );
        const issueBody = issue.json as { title: string; body: string };
        expect(issueBody.title).toBe(brief.title);
        expect(issueBody.body).toContain("@claude");
        expect(issueBody.body).toContain("Export the board as CSV");
        expect(issueBody.body).not.toContain(secret);

        const withHandoff = await expectJson<{ handoffs: Handoff[] }>(
          await world.as("viewer").get(taskUrl),
        );
        expect(withHandoff.handoffs).toEqual([
          expect.objectContaining({
            id: sent.handoff.id,
            issueNumber: 42,
            state: "issue_created",
          }),
        ]);
      } finally {
        await owner.delete(`/api/gitea-integration/project/${project.id}`);
      }
    } finally {
      await owner.delete(`/api/project/${project.id}`);
    }
  },
);
