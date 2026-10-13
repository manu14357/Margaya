import { expect, test } from "../../fixtures";
import {
  createProject,
  createWorld,
  expectJson,
  expectStatus,
  type Project,
  type World,
} from "../../helpers/api-kit";
import { covers } from "../../helpers/openapi";
import type { ReceivedRequest, WebhookSink } from "../../helpers/webhook-sink";

// Project integrations: CRUD and secret masking for every provider, Gitea
// end to end against a fake Gitea served by the webhook sink, the GitHub
// guards (no GitHub App locally), and workflow rules. Outgoing deliveries of
// the generic webhook are covered in specs/notifications/webhooks.spec.ts.
// Chat providers point at their real hosts (shape checks), so their project
// never gets a task event while they are connected.

let world: World;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  world = await createWorld("Integrations");
});

test.afterAll(async () => {
  await world?.dispose();
});

const EVENTS_OFF = {
  taskCreated: false,
  taskStatusChanged: false,
  taskPriorityChanged: false,
  taskTitleChanged: false,
  taskDescriptionChanged: false,
  taskCommentCreated: false,
};

type ChatIntegration = {
  id: string;
  projectId: string;
  channelName?: string | null;
  webhookConfigured?: boolean;
  maskedWebhookUrl?: string;
  events: Record<string, boolean>;
  isActive: boolean | null;
};

/** CRUD every chat-style provider the same way, with masking and roles. */
async function exerciseChatProvider(
  provider: "discord" | "slack" | "mattermost",
  webhookUrl: string,
  invalidUrl: string,
) {
  const owner = world.as("owner");
  const project: Project = await createProject(owner, world.workspace.id);
  const base = `/api/${provider}-integration/project/${project.id}`;
  try {
    expect(await expectJson(await world.as("viewer").get(base))).toBeNull();

    await expectStatus(
      await world
        .as("member")
        .post(base, { data: { webhookUrl, events: EVENTS_OFF } }),
      403,
    );
    await expectStatus(
      await owner.post(base, { data: { webhookUrl: invalidUrl } }),
      400,
    );

    const created = await expectJson<ChatIntegration>(
      await world.as("admin").post(base, {
        data: { webhookUrl, channelName: "#e2e", events: EVENTS_OFF },
      }),
    );
    expect(created).toMatchObject({
      projectId: project.id,
      channelName: "#e2e",
      webhookConfigured: true,
      isActive: true,
    });
    // The webhook URL is a credential: never returned in full.
    expect(JSON.stringify(created)).not.toContain(webhookUrl);

    const fetched = await expectJson<ChatIntegration>(
      await world.as("viewer").get(base),
    );
    expect(fetched.id).toBe(created.id);
    expect(JSON.stringify(fetched)).not.toContain(webhookUrl);

    const updated = await expectJson<ChatIntegration>(
      await owner.patch(base, {
        data: {
          isActive: false,
          channelName: null,
          events: { taskCommentCreated: true },
        },
      }),
    );
    expect(updated).toMatchObject({ isActive: false, channelName: null });
    // Event toggles merge into the existing set.
    expect(updated.events).toMatchObject({
      taskCommentCreated: true,
      taskCreated: false,
    });

    await expectStatus(await world.as("member").delete(base), 403);
    expect(await expectJson(await owner.delete(base))).toEqual({
      success: true,
    });
    await expectStatus(await owner.delete(base), 404);
    await expectStatus(
      await owner.patch(base, { data: { isActive: true } }),
      404,
    );
  } finally {
    await owner.delete(`/api/project/${project.id}`);
  }
}

test(
  "Discord integration",
  covers(
    "getDiscordIntegration",
    "createDiscordIntegration",
    "updateDiscordIntegration",
    "deleteDiscordIntegration",
  ),
  async () => {
    await exerciseChatProvider(
      "discord",
      "https://discord.com/api/webhooks/123456789/e2e-not-a-real-token",
      "https://example.com/not-discord",
    );
  },
);

test(
  "Slack integration",
  covers(
    "getSlackIntegration",
    "createSlackIntegration",
    "updateSlackIntegration",
    "deleteSlackIntegration",
  ),
  async () => {
    await exerciseChatProvider(
      "slack",
      "https://hooks.slack.com/services/TE2E0000/BE2E0000/e2enotarealtoken",
      "https://hooks.slack.com/nope",
    );
  },
);

test(
  "Mattermost integration",
  covers(
    "getMattermostIntegration",
    "createMattermostIntegration",
    "updateMattermostIntegration",
    "deleteMattermostIntegration",
  ),
  async () => {
    await exerciseChatProvider(
      "mattermost",
      "https://127.0.0.1:9/hooks/e2e-not-a-real-hook",
      "http://127.0.0.1:9/hooks/plain-http",
    );
  },
);

test(
  "Telegram integration",
  covers(
    "getTelegramIntegration",
    "createTelegramIntegration",
    "updateTelegramIntegration",
    "deleteTelegramIntegration",
  ),
  async () => {
    const owner = world.as("owner");
    const project = await createProject(owner, world.workspace.id);
    const base = `/api/telegram-integration/project/${project.id}`;
    const botToken = `12345678:${"A".repeat(35)}`;
    try {
      expect(await expectJson(await owner.get(base))).toBeNull();
      await expectStatus(
        await owner.post(base, {
          data: { botToken: "not-a-token", chatId: "42" },
        }),
        400,
      );
      await expectStatus(
        await world
          .as("member")
          .post(base, { data: { botToken, chatId: "42" } }),
        403,
      );
      const created = await expectJson<{
        chatId: string;
        threadId: number | null;
        chatLabel: string | null;
        botTokenConfigured: boolean;
        maskedBotToken: string;
      }>(
        await owner.post(base, {
          data: {
            botToken,
            chatId: "-100200300",
            threadId: 7,
            chatLabel: "E2E",
            events: EVENTS_OFF,
          },
        }),
      );
      expect(created).toMatchObject({
        chatId: "-100200300",
        threadId: 7,
        chatLabel: "E2E",
        botTokenConfigured: true,
      });
      expect(JSON.stringify(created)).not.toContain(botToken);

      const updated = await expectJson<{
        threadId: number | null;
        chatLabel: string | null;
      }>(
        await owner.patch(base, { data: { threadId: null, chatLabel: null } }),
      );
      expect(updated).toMatchObject({ threadId: null, chatLabel: null });
      expect(
        JSON.stringify(await expectJson(await world.as("viewer").get(base))),
      ).not.toContain(botToken);
      expect(await expectJson(await owner.delete(base))).toEqual({
        success: true,
      });
      await expectStatus(await owner.delete(base), 404);
    } finally {
      await owner.delete(`/api/project/${project.id}`);
    }
  },
);

test(
  "generic webhook integration: create, mask, update and delete",
  covers(
    "getGenericWebhookIntegration",
    "createGenericWebhookIntegration",
    "updateGenericWebhookIntegration",
    "deleteGenericWebhookIntegration",
  ),
  async ({ webhookSink }) => {
    const owner = world.as("owner");
    const project = await createProject(owner, world.workspace.id);
    const base = `/api/generic-webhook-integration/project/${project.id}`;
    const url = `${webhookSink.url}/hooks/crud`;
    const secret = "e2e-generic-webhook-secret";
    try {
      expect(await expectJson(await owner.get(base))).toBeNull();
      await expectStatus(
        await owner.post(base, { data: { webhookUrl: "ftp://example.com" } }),
        400,
      );
      await expectStatus(
        await world.as("member").post(base, { data: { webhookUrl: url } }),
        403,
      );
      type Generic = {
        webhookConfigured: boolean;
        maskedWebhookUrl: string | null;
        secretConfigured: boolean;
        maskedSecret: string | null;
        events: Record<string, boolean>;
        dueDateReminderLeadTimeMinutes: number;
        isActive: boolean | null;
      };
      const created = await expectJson<Generic>(
        await world.as("admin").post(base, {
          data: {
            webhookUrl: url,
            secret,
            events: { taskCreated: true, taskDeleted: true },
            dueDateReminderLeadTimeMinutes: 120,
          },
        }),
      );
      expect(created).toMatchObject({
        webhookConfigured: true,
        secretConfigured: true,
        dueDateReminderLeadTimeMinutes: 120,
        isActive: true,
      });
      expect(created.events).toMatchObject({
        taskCreated: true,
        taskDeleted: true,
      });
      const serialized = JSON.stringify(
        await expectJson(await world.as("viewer").get(base)),
      );
      expect(serialized).not.toContain(secret);
      expect(serialized).not.toContain("/hooks/crud");

      const updated = await expectJson<Generic>(
        await owner.patch(base, {
          data: { secret: null, isActive: false, events: { taskMoved: true } },
        }),
      );
      expect(updated).toMatchObject({
        secretConfigured: false,
        maskedSecret: null,
        isActive: false,
      });
      expect(updated.events).toMatchObject({
        taskMoved: true,
        taskCreated: true,
      });

      expect(await expectJson(await owner.delete(base))).toEqual({
        success: true,
      });
      await expectStatus(await owner.delete(base), 404);
    } finally {
      await owner.delete(`/api/project/${project.id}`);
    }
  },
);

/** A tiny Gitea API: one user, one repository with one open issue. */
function serveFakeGitea(sink: WebhookSink) {
  const html = `${sink.url}/e2e/demo`;
  sink.respondWith((request: ReceivedRequest) => {
    const json = (body: unknown, status = 200) => ({
      status,
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    });
    const [pathname = "", query = ""] = request.path.split("?");
    const page = new URLSearchParams(query).get("page") ?? "1";
    if (pathname.startsWith("/not-gitea"))
      return json({ message: "Not Found" }, 404);
    if (request.headers.authorization !== "token e2e-gitea-token") {
      return json({ message: "token is required" }, 401);
    }
    if (pathname === "/api/v1/user") return json({ id: 1, login: "e2e-bot" });
    if (pathname === "/api/v1/user/repos") {
      return json(
        page === "1"
          ? [
              {
                id: 1,
                name: "demo",
                full_name: "e2e/demo",
                owner: { login: "e2e" },
                private: false,
                html_url: html,
              },
            ]
          : [],
      );
    }
    if (pathname === "/api/v1/repos/e2e/demo") {
      return json({
        name: "demo",
        owner: { login: "e2e" },
        html_url: html,
        private: false,
        permissions: { admin: true, push: true, pull: true },
      });
    }
    if (
      pathname === "/api/v1/repos/e2e/demo/issues" &&
      request.method === "GET"
    ) {
      return json(
        page === "1"
          ? [
              {
                id: 101,
                number: 7,
                title: "Imported from the fake Gitea",
                body: "Issue body",
                html_url: `${html}/issues/7`,
                state: "open",
                labels: [],
                user: { login: "alice" },
              },
            ]
          : [],
      );
    }
    if (/\/issues\/7\/comments$/.test(pathname) && request.method === "GET")
      return json([]);
    if (pathname === "/api/v1/repos/e2e/demo/pulls") return json([]);
    if (request.method !== "GET") {
      return json(
        {
          id: 1,
          body: "",
          html_url: `${html}/issues/7#c1`,
          created_at: new Date().toISOString(),
        },
        201,
      );
    }
    return json({ message: "Not Found" }, 404);
  });
}

test(
  "Gitea integration end to end against a fake Gitea",
  covers(
    "verifyGiteaAccess",
    "listGiteaRepositories",
    "createGiteaIntegration",
    "getGiteaIntegration",
    "updateGiteaIntegration",
    "importGiteaIssues",
    "deleteGiteaIntegration",
    "getExternalLinksByTask",
  ),
  async ({ webhookSink }) => {
    serveFakeGitea(webhookSink);
    const owner = world.as("owner");
    const project = await createProject(owner, world.workspace.id);
    const base = `/api/gitea-integration/project/${project.id}`;
    const access = {
      projectId: project.id,
      baseUrl: webhookSink.url,
      accessToken: "e2e-gitea-token",
    };
    try {
      const verified = await expectJson<{
        isInstalled: boolean;
        hasRequiredPermissions: boolean;
        repositoryExists: boolean;
        failureReason: string | null;
      }>(
        await owner.post("/api/gitea-integration/verify", {
          data: { ...access, repositoryOwner: "e2e", repositoryName: "demo" },
        }),
      );
      expect(verified).toMatchObject({
        isInstalled: true,
        hasRequiredPermissions: true,
        repositoryExists: true,
        failureReason: null,
      });
      const notGitea = await expectJson<{
        isInstalled: boolean;
        failureReason: string | null;
      }>(
        await owner.post("/api/gitea-integration/verify", {
          data: {
            ...access,
            baseUrl: `${webhookSink.url}/not-gitea`,
            repositoryOwner: "e2e",
            repositoryName: "demo",
          },
        }),
      );
      expect(notGitea).toMatchObject({
        isInstalled: false,
        failureReason: "not_a_gitea_instance",
      });
      const missingRepo = await expectJson<{ failureReason: string | null }>(
        await owner.post("/api/gitea-integration/verify", {
          data: {
            ...access,
            repositoryOwner: "e2e",
            repositoryName: "missing",
          },
        }),
      );
      expect(missingRepo.failureReason).toBe("repository_not_found");
      await expectStatus(
        await world.as("member").post("/api/gitea-integration/verify", {
          data: { ...access, repositoryOwner: "e2e", repositoryName: "demo" },
        }),
        403,
      );

      const repositories = await expectJson<{
        repositories: { name: string; full_name?: string }[];
      }>(
        await owner.post("/api/gitea-integration/repositories", {
          data: access,
        }),
      );
      expect(repositories.repositories.map((repo) => repo.name)).toEqual([
        "demo",
      ]);
      await expectStatus(
        await owner.post("/api/gitea-integration/repositories", {
          data: { ...access, baseUrl: "not a url" },
        }),
        400,
      );

      const created = await expectJson<{
        id: string;
        baseUrl: string;
        repositoryOwner: string;
        repositoryName: string;
        webhookSecret?: string;
        isActive: boolean;
      }>(
        await owner.post(base, {
          data: {
            baseUrl: webhookSink.url,
            accessToken: "e2e-gitea-token",
            repositoryOwner: "e2e",
            repositoryName: "demo",
          },
        }),
      );
      expect(created).toMatchObject({
        repositoryOwner: "e2e",
        repositoryName: "demo",
        isActive: true,
      });
      expect(created.webhookSecret).toBeTruthy();

      // The access token never comes back; the webhook secret only for
      // callers with workspace:manage_settings.
      const forAdmin = await expectJson<{
        maskedAccessToken: string;
        webhookSecret?: string;
        webhookUrl?: string;
      }>(await world.as("admin").get(base));
      expect(JSON.stringify(forAdmin)).not.toContain("e2e-gitea-token");
      expect(forAdmin.webhookSecret).toBe(created.webhookSecret);
      expect(forAdmin.webhookUrl).toContain(
        `/api/gitea-integration/webhook/${created.id}`,
      );
      const forMember = await expectJson<{ webhookSecret?: string }>(
        await world.as("member").get(base),
      );
      expect(forMember.webhookSecret ?? "").toBe("");
      expect(JSON.stringify(forMember)).not.toContain("e2e-gitea-token");

      const updated = await expectJson<{
        commentTaskLinkOnGiteaIssue?: boolean;
      }>(
        await owner.patch(base, {
          data: { commentTaskLinkOnGiteaIssue: false },
        }),
      );
      expect(updated.commentTaskLinkOnGiteaIssue).toBe(false);

      await expectStatus(
        await world.as("viewer").post("/api/gitea-integration/import-issues", {
          data: { projectId: project.id },
        }),
        403,
      );
      const imported = await expectJson<{
        imported: number;
        updated: number;
        skipped: number;
        errors?: string[];
      }>(
        await owner.post("/api/gitea-integration/import-issues", {
          data: { projectId: project.id },
        }),
      );
      expect(imported).toMatchObject({ imported: 1, updated: 0 });
      // Importing again refreshes rather than duplicates.
      const again = await expectJson<{
        imported: number;
        updated: number;
        skipped: number;
      }>(
        await owner.post("/api/gitea-integration/import-issues", {
          data: { projectId: project.id },
        }),
      );
      expect(again.imported).toBe(0);

      const board = await expectJson<{
        data: { columns: { tasks: { id: string; title: string }[] }[] };
      }>(await owner.get(`/api/task/tasks/${project.id}`));
      const task = board.data.columns
        .flatMap((column) => column.tasks)
        .find((entry) => entry.title === "Imported from the fake Gitea");
      expect(task).toBeTruthy();
      const links = await expectJson<
        { resourceType: string; externalId: string; url: string }[]
      >(await world.as("viewer").get(`/api/external-link/task/${task?.id}`));
      expect(links).toEqual([
        expect.objectContaining({
          url: `${webhookSink.url}/e2e/demo/issues/7`,
        }),
      ]);

      expect(await expectJson(await owner.delete(base))).toMatchObject({
        success: true,
      });
      await expectStatus(await owner.delete(base), 404);
      await expectStatus(
        await owner.post("/api/gitea-integration/import-issues", {
          data: { projectId: project.id },
        }),
        404,
      );
    } finally {
      await owner.delete(`/api/project/${project.id}`);
    }
  },
);

test(
  "GitHub: the app info answers, linking needs a connected GitHub account",
  covers(
    "getGitHubAppInfo",
    "getGitHubIntegration",
    "listGitHubRepositories",
    "verifyGitHubInstallation",
    "createGitHubIntegration",
    "updateGitHubIntegration",
    "deleteGitHubIntegration",
    "importGitHubIssues",
  ),
  async () => {
    // No GitHub App or GitHub account locally (allowlisted in coverage.spec.ts).
    const owner = world.as("owner");
    const project = await createProject(owner, world.workspace.id);
    try {
      const info = await expectJson<{
        appName: string | null;
        accountConnected: boolean;
      }>(await owner.get("/api/github-integration/app-info"));
      expect(info.accountConnected).toBe(false);
      expect(
        await expectJson(
          await owner.get(`/api/github-integration/project/${project.id}`),
        ),
      ).toBeNull();

      const connect = /Connect your GitHub account/i;
      expect(
        await expectStatus(
          await owner.get(`/api/github-integration/repositories/${project.id}`),
          403,
        ),
      ).toMatch(connect);
      expect(
        await expectStatus(
          await owner.post("/api/github-integration/verify", {
            data: {
              projectId: project.id,
              repositoryOwner: "octo",
              repositoryName: "repo",
            },
          }),
          403,
        ),
      ).toMatch(connect);
      expect(
        await expectStatus(
          await owner.post(`/api/github-integration/project/${project.id}`, {
            data: { repositoryOwner: "octo", repositoryName: "repo" },
          }),
          403,
        ),
      ).toMatch(connect);
      await expectStatus(
        await owner.patch(`/api/github-integration/project/${project.id}`, {
          data: { isActive: false },
        }),
        404,
      );
      await expectStatus(
        await owner.delete(`/api/github-integration/project/${project.id}`),
        404,
      );
      await expectStatus(
        await owner.post("/api/github-integration/import-issues", {
          data: { projectId: project.id },
        }),
        404,
      );
      // Members are stopped before the GitHub account check.
      await expectStatus(
        await world
          .as("member")
          .get(`/api/github-integration/repositories/${project.id}`),
        403,
      );
      await expectStatus(
        await owner.post("/api/github-integration/verify", {
          data: {
            projectId: project.id,
            repositoryOwner: "",
            repositoryName: "repo",
          },
        }),
        400,
      );
    } finally {
      await owner.delete(`/api/project/${project.id}`);
    }
  },
);

test(
  "workflow rules",
  covers("getWorkflowRules", "upsertWorkflowRule", "deleteWorkflowRule"),
  async () => {
    const owner = world.as("owner");
    const project = await createProject(owner, world.workspace.id);
    try {
      const columns = await expectJson<
        { id: string; slug: string; name: string }[]
      >(await owner.get(`/api/column/${project.id}`));
      const review = columns.find((column) => column.slug === "in-review");
      const done = columns.find((column) => column.slug === "done");
      expect(
        await expectJson(
          await world.as("viewer").get(`/api/workflow-rule/${project.id}`),
        ),
      ).toEqual([]);

      const rule = await expectJson<{
        id: string;
        integrationType: string;
        eventType: string;
        columnId: string;
      }>(
        await world.as("admin").put(`/api/workflow-rule/${project.id}`, {
          data: {
            integrationType: "gitea",
            eventType: "pr_merged",
            columnId: review?.id,
          },
        }),
      );
      expect(rule).toMatchObject({
        integrationType: "gitea",
        eventType: "pr_merged",
        columnId: review?.id,
      });
      // Same integration and event: the rule's column is updated in place.
      const moved = await expectJson<{ id: string; columnId: string }>(
        await owner.put(`/api/workflow-rule/${project.id}`, {
          data: {
            integrationType: "gitea",
            eventType: "pr_merged",
            columnId: done?.id,
          },
        }),
      );
      expect(moved).toMatchObject({ id: rule.id, columnId: done?.id });

      const rules = await expectJson<
        { id: string; columnSlug: string | null }[]
      >(await world.as("viewer").get(`/api/workflow-rule/${project.id}`));
      expect(rules).toEqual([
        expect.objectContaining({ id: rule.id, columnSlug: "done" }),
      ]);

      await expectStatus(
        await world.as("member").put(`/api/workflow-rule/${project.id}`, {
          data: {
            integrationType: "gitea",
            eventType: "pr_opened",
            columnId: review?.id,
          },
        }),
        403,
      );
      await expectStatus(
        await owner.put(`/api/workflow-rule/${project.id}`, {
          data: { integrationType: "gitea" },
        }),
        400,
      );
      await expectStatus(
        await world.as("member").delete(`/api/workflow-rule/${rule.id}`),
        403,
      );
      const deleted = await expectJson<{ id: string }>(
        await owner.delete(`/api/workflow-rule/${rule.id}`),
      );
      expect(deleted.id).toBe(rule.id);
      expect(
        await expectJson(await owner.get(`/api/workflow-rule/${project.id}`)),
      ).toEqual([]);
    } finally {
      await owner.delete(`/api/project/${project.id}`);
    }
  },
);
