import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { refreshInstanceSettings } from "../../apps/api/src/instance-settings/snapshot";
import { initializePlugins } from "../../apps/api/src/plugins";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createFakeGithub,
  type FakeGithub,
  GITHUB_PRIVATE_KEY,
  signedWebhook,
  WEBHOOK_SECRET,
} from "./helpers/fake-github";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

// End to end for the GitHub integration: Margaya's real routes, database,
// event plugins and webhook verification, against a fake GitHub API.

type App = ReturnType<typeof createApp>["app"];

let app: App;
let github: FakeGithub;
let ctx: Awaited<ReturnType<typeof setUp>>;

beforeAll(() => {
  initializePlugins();
});

beforeEach(async () => {
  await resetTestDatabase();
  github = createFakeGithub();
  github.install();
  app = createApp().app;
  ctx = await setUp();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function setUp() {
  // The GitHub App, saved in the instance settings like the admin page does.
  await db.insert(schema.instanceSettingTable).values([
    { key: "githubApp.appId", value: "123456" },
    { key: "githubApp.appName", value: "margaya-e2e" },
    { key: "githubApp.privateKey", value: GITHUB_PRIVATE_KEY },
    { key: "githubApp.webhookSecret", value: WEBHOOK_SECRET },
  ]);
  await refreshInstanceSettings();

  const owner = await createWorkspaceMember({ role: "owner" });
  const { project } = await createProjectFixture({
    workspaceId: owner.workspace.id,
    name: "Website",
    slug: "web",
  });
  // The owner linked their GitHub account (Connect GitHub).
  await db.insert(schema.accountTable).values({
    id: randomUUID(),
    accountId: String(github.state.account.id),
    providerId: "github",
    userId: owner.user.id,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  mockAuthenticatedSession(owner.user);
  return { owner, project };
}

function call(method: string, path: string, body?: unknown) {
  return app.request(`/api${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function connect() {
  const response = await call(
    "POST",
    `/github-integration/project/${ctx.project.id}`,
    { repositoryOwner: "studio-north", repositoryName: "website" },
  );
  expect(response.status).toBe(200);
}

async function createTask(title: string, extra: Record<string, unknown> = {}) {
  const response = await call("POST", `/task/${ctx.project.id}`, {
    title,
    description: `${title} details`,
    priority: "medium",
    status: "to-do",
    ...extra,
  });
  expect(response.status).toBe(200);
  return (await response.json()) as { id: string; number: number };
}

function webhook(event: string, payload: Record<string, unknown>) {
  return app.request(
    "/api/github-integration/webhook",
    signedWebhook(event, { ...github.source(), ...payload }),
  );
}

async function task(id: string) {
  const row = await db.query.taskTable.findFirst({
    where: eq(schema.taskTable.id, id),
  });
  if (!row) throw new Error(`task ${id} missing`);
  return row;
}

async function taskForIssue(number: number) {
  const link = await db.query.externalLinkTable.findFirst({
    where: and(
      eq(schema.externalLinkTable.resourceType, "issue"),
      eq(schema.externalLinkTable.externalId, String(number)),
    ),
  });
  return link ? task(link.taskId) : null;
}

/** The fake issue Margaya created for a task, once the plugin has run. */
async function issueFor(taskId: string) {
  let number = 0;
  await vi.waitFor(
    async () => {
      const link = await db.query.externalLinkTable.findFirst({
        where: and(
          eq(schema.externalLinkTable.taskId, taskId),
          eq(schema.externalLinkTable.resourceType, "issue"),
        ),
      });
      expect(link).toBeDefined();
      number = Number(link?.externalId);
    },
    { timeout: 15_000, interval: 50 },
  );
  const issue = github.state.issues.get(number);
  if (!issue) throw new Error(`issue #${number} missing`);
  return issue;
}

const eventually = (assertion: () => unknown | Promise<unknown>) =>
  vi.waitFor(assertion, { timeout: 15_000, interval: 50 });

describe("GitHub end to end: setting up and connecting", () => {
  it("reports the App and the linked account", async () => {
    const response = await call("GET", "/github-integration/app-info");
    expect(await response.json()).toMatchObject({
      appConfigured: true,
      accountConnected: true,
      accountLinkingAvailable: false,
      appName: "margaya-e2e",
    });
  });

  it("browses, verifies and connects the repository, then reads it back", async () => {
    const list = await call(
      "GET",
      `/github-integration/repositories/${ctx.project.id}`,
    );
    expect(list.status).toBe(200);
    const listed = (await list.json()) as {
      repositories: Array<{ full_name: string }>;
    };
    expect(listed.repositories.map((repo) => repo.full_name)).toEqual([
      "studio-north/website",
    ]);

    const verify = await call("POST", "/github-integration/verify", {
      projectId: ctx.project.id,
      repositoryOwner: "studio-north",
      repositoryName: "website",
    });
    expect(await verify.json()).toMatchObject({
      isInstalled: true,
      repositoryExists: true,
      hasRequiredPermissions: true,
      installationUrl:
        "https://github.com/apps/margaya-e2e/installations/new/permissions?target_id=501",
    });

    await connect();
    const read = await call(
      "GET",
      `/github-integration/project/${ctx.project.id}`,
    );
    expect(await read.json()).toMatchObject({
      repositoryOwner: "studio-north",
      repositoryName: "website",
      isActive: true,
      requiresVerification: false,
    });
  });

  it("doesn't reveal whether the App is installed on a repository it can't verify", async () => {
    // Ownership is checked first and fails without an installation, so the
    // answer is the same as for a repository the caller doesn't administer.
    const verify = await call("POST", "/github-integration/verify", {
      projectId: ctx.project.id,
      repositoryOwner: "studio-north",
      repositoryName: "elsewhere",
    });
    expect(verify.status).toBe(403);
    expect(await verify.text()).toContain(
      "Repository access could not be verified",
    );
  });

  it("refuses to connect without repository admin rights", async () => {
    github.state.permission = "write";
    const response = await call(
      "POST",
      `/github-integration/project/${ctx.project.id}`,
      { repositoryOwner: "studio-north", repositoryName: "website" },
    );
    expect(response.status).toBe(403);
  });
});

describe("GitHub end to end: Margaya to GitHub", () => {
  beforeEach(connect);

  it("opens an issue with labels and a task link for a new task", async () => {
    const created = await createTask("Hero banner");
    const issue = await issueFor(created.id);
    expect(issue.title).toBe("Hero banner");
    expect(issue.body).toContain("Hero banner details");
    await eventually(() => {
      expect(issue.labels).toEqual(
        expect.arrayContaining(["priority:medium", "status:to-do"]),
      );
      expect(issue.comments).toEqual([
        expect.stringMatching(
          new RegExp(
            `^\\[WEB-${created.number}\\]\\(.+/task/${created.id}\\)$`,
          ),
        ),
      ]);
    });
    expect(github.state.repoLabels.has("priority:medium")).toBe(true);
  });

  it("keeps the issue's title, body and priority in step with the task", async () => {
    const created = await createTask("Pricing page");
    const issue = await issueFor(created.id);

    expect(
      (await call("PUT", `/task/title/${created.id}`, { title: "Pricing v2" }))
        .status,
    ).toBe(200);
    await eventually(() => expect(issue.title).toBe("Pricing v2"));

    expect(
      (
        await call("PUT", `/task/description/${created.id}`, {
          description: "New pricing copy",
        })
      ).status,
    ).toBe(200);
    await eventually(() => expect(issue.body).toContain("New pricing copy"));

    expect(
      (await call("PUT", `/task/priority/${created.id}`, { priority: "high" }))
        .status,
    ).toBe(200);
    await eventually(() => {
      expect(issue.labels).toContain("priority:high");
      expect(issue.labels).not.toContain("priority:medium");
    });
  });

  it("closes the issue when the task is done and reopens it after", async () => {
    const created = await createTask("Footer links");
    const issue = await issueFor(created.id);

    await call("PUT", `/task/status/${created.id}`, { status: "done" });
    await eventually(() => {
      expect(issue.state).toBe("closed");
      expect(issue.labels).toContain("status:done");
      expect(issue.labels).not.toContain("status:to-do");
    });

    await call("PUT", `/task/status/${created.id}`, { status: "in-progress" });
    await eventually(() => {
      expect(issue.state).toBe("open");
      expect(issue.labels).toContain("status:in-progress");
      expect(issue.labels).not.toContain("status:done");
    });
  });

  it("copies task comments to the issue", async () => {
    const created = await createTask("Contact form");
    const issue = await issueFor(created.id);
    const response = await call("POST", "/activity/comment", {
      taskId: created.id,
      comment: "Please use the new form endpoint",
    });
    expect(response.status).toBe(200);
    // Posted under the App's name, so it says who wrote it.
    await eventually(() =>
      expect(issue.comments).toContainEqual(
        expect.stringMatching(
          /^\*\*.+\*\* commented:\n> Please use the new form endpoint$/,
        ),
      ),
    );
  });

  it("skips the task-link comment when that setting is off", async () => {
    const patch = await call(
      "PATCH",
      `/github-integration/project/${ctx.project.id}`,
      { commentTaskLinkOnGitHubIssue: false },
    );
    expect(patch.status).toBe(200);
    const created = await createTask("Blog index");
    const issue = await issueFor(created.id);
    // The labels come after the link comment would have; wait for them.
    await eventually(() => expect(issue.labels).toContain("status:to-do"));
    expect(issue.comments).toEqual([]);
  });
});

describe("GitHub end to end: GitHub to Margaya", () => {
  beforeEach(connect);

  it("creates a task for a new issue, with its priority and a link back", async () => {
    const issue = github.openIssue({
      title: "Broken link on About",
      body: "The team link 404s",
      labels: ["priority:urgent"],
    });
    const response = await webhook("issues", {
      action: "opened",
      issue: github.issueJson(issue),
    });
    expect(response.status).toBe(200);

    const created = await taskForIssue(issue.number);
    expect(created).toMatchObject({
      title: "Broken link on About",
      priority: "urgent",
      status: "to-do",
      projectId: ctx.project.id,
    });
    expect(created?.description).toContain("The team link 404s");
    expect(issue.comments).toEqual([
      expect.stringMatching(/^\[WEB-\d+\]\(.+\)$/),
    ]);
  });

  it("doesn't create a second task for an issue Margaya opened", async () => {
    const created = await createTask("Newsletter signup");
    const issue = await issueFor(created.id);
    await webhook("issues", {
      action: "opened",
      issue: github.issueJson(issue),
    });
    const tasks = await db.query.taskTable.findMany({
      where: eq(schema.taskTable.projectId, ctx.project.id),
    });
    expect(tasks).toHaveLength(1);
  });

  it("follows edits, closing, reopening and labels on GitHub", async () => {
    const issue = github.openIssue({ title: "Logo blurry" });
    await webhook("issues", {
      action: "opened",
      issue: github.issueJson(issue),
    });
    const linked = await taskForIssue(issue.number);
    if (!linked) throw new Error("no task");

    issue.title = "Logo blurry on retina";
    issue.body = "Use the SVG";
    await webhook("issues", {
      action: "edited",
      issue: github.issueJson(issue),
      changes: { title: { from: "Logo blurry" }, body: { from: "" } },
    });
    expect(await task(linked.id)).toMatchObject({
      title: "Logo blurry on retina",
      description: "Use the SVG",
    });

    issue.state = "closed";
    await webhook("issues", {
      action: "closed",
      issue: github.issueJson(issue),
    });
    expect((await task(linked.id)).status).toBe("done");

    issue.state = "open";
    await webhook("issues", {
      action: "reopened",
      issue: github.issueJson(issue),
    });
    expect((await task(linked.id)).status).not.toBe("done");

    issue.labels = ["priority:high", "bug"];
    await webhook("issues", {
      action: "labeled",
      issue: github.issueJson(issue),
      label: { name: "priority:high", color: "F97316" },
    });
    expect((await task(linked.id)).priority).toBe("high");

    await webhook("issues", {
      action: "labeled",
      issue: github.issueJson(issue),
      label: { name: "bug", color: "d73a4a" },
    });
    const labels = await db.query.labelTable.findMany({
      where: eq(schema.labelTable.taskId, linked.id),
    });
    expect(labels.map((label) => label.name)).toContain("bug");

    issue.labels = ["priority:high"];
    await webhook("issues", {
      action: "unlabeled",
      issue: github.issueJson(issue),
      label: { name: "bug", color: "d73a4a" },
    });
    const after = await db.query.labelTable.findMany({
      where: eq(schema.labelTable.taskId, linked.id),
    });
    expect(after.map((label) => label.name)).not.toContain("bug");
  });

  it("shows GitHub comments on the task and ignores bot comments", async () => {
    const issue = github.openIssue({ title: "Cookie banner" });
    await webhook("issues", {
      action: "opened",
      issue: github.issueJson(issue),
    });
    const linked = await taskForIssue(issue.number);
    for (const [login, body] of [
      ["a-reviewer", "Needs legal sign-off"],
      ["margaya-e2e[bot]", "Automated note"],
    ]) {
      await webhook("issue_comment", {
        action: "created",
        issue: github.issueJson(issue),
        comment: {
          id: Math.floor(Math.random() * 1e6),
          body,
          html_url: `${issue.html_url}#issuecomment-${body.length}`,
          user: { login, avatar_url: "https://avatars.example/x.png" },
        },
      });
    }
    const comments = await db.query.activityTable.findMany({
      where: and(
        eq(schema.activityTable.taskId, linked?.id ?? ""),
        eq(schema.activityTable.externalSource, "github"),
      ),
    });
    expect(comments.map((comment) => comment.content)).toEqual([
      "Needs legal sign-off",
    ]);
    expect(comments[0]?.externalUserName).toBe("a-reviewer");
  });

  it("moves the task along with branch pushes and pull requests", async () => {
    const created = await createTask("Search box");
    await issueFor(created.id);
    const branch = `web-${created.number}-search-box`;

    await webhook("push", {
      ref: "refs/heads/main",
      head_commit: { id: "abc", message: "chore" },
    });
    expect((await task(created.id)).status).toBe("to-do");

    await webhook("push", {
      ref: `refs/heads/${branch}`,
      head_commit: { id: "def", message: "Start search box" },
      commits: [{ id: "def", message: "Start search box" }],
    });
    expect((await task(created.id)).status).toBe("in-progress");

    const pull = {
      number: 300,
      title: "Search box",
      body: "Adds search",
      html_url: "https://github.com/studio-north/website/pull/300",
      state: "open",
      draft: true,
      merged: false,
      merged_at: null,
      head: { ref: branch },
      user: { login: "a-contributor" },
    };
    await webhook("pull_request", { action: "opened", pull_request: pull });
    expect((await task(created.id)).status).toBe("in-review");
    const link = await db.query.externalLinkTable.findFirst({
      where: and(
        eq(schema.externalLinkTable.taskId, created.id),
        eq(schema.externalLinkTable.resourceType, "pull_request"),
      ),
    });
    expect(link?.externalId).toBe("300");

    await webhook("pull_request", {
      action: "ready_for_review",
      pull_request: { ...pull, draft: false },
    });
    const ready = await db.query.externalLinkTable.findFirst({
      where: eq(schema.externalLinkTable.id, link?.id ?? ""),
    });
    expect(JSON.parse(ready?.metadata ?? "{}").draft).toBe(false);

    await webhook("pull_request", {
      action: "closed",
      pull_request: {
        ...pull,
        draft: false,
        state: "closed",
        merged: true,
        merged_at: "2026-11-19T12:00:00Z",
      },
    });
    expect((await task(created.id)).status).toBe("done");
  });

  it("adds a label created on GitHub to the workspace", async () => {
    await webhook("label", {
      action: "created",
      label: { name: "design", color: "a2eeef" },
    });
    const label = await db.query.labelTable.findFirst({
      where: and(
        eq(schema.labelTable.workspaceId, ctx.owner.workspace.id),
        eq(schema.labelTable.name, "design"),
      ),
    });
    expect(label?.color).toBe("#a2eeef");
  });

  it("refuses deliveries with a wrong signature and ignores other repositories", async () => {
    const issue = github.openIssue({ title: "Forged" });
    const forged = await app.request(
      "/api/github-integration/webhook",
      signedWebhook(
        "issues",
        {
          ...github.source(),
          action: "opened",
          issue: github.issueJson(issue),
        },
        "not-the-secret",
      ),
    );
    expect(forged.status).toBe(400);

    const elsewhere = await app.request(
      "/api/github-integration/webhook",
      signedWebhook("issues", {
        ...github.source(),
        repository: {
          id: 1234,
          name: "other",
          full_name: "someone/other",
          owner: { login: "someone" },
        },
        action: "opened",
        issue: github.issueJson(issue),
      }),
    );
    expect(elsewhere.status).toBe(200);
    expect(await taskForIssue(issue.number)).toBeNull();
  });
});

describe("GitHub end to end: import and disconnect", () => {
  beforeEach(connect);

  it("imports open issues with labels and comments, links open pull requests, and doesn't duplicate on a second run", async () => {
    github.openIssue({
      title: "Old: slow images",
      body: "Compress them",
      labels: ["priority:high"],
      comments: ["Seen on mobile too"],
    });
    github.openIssue({ title: "Old: typo in footer" });
    github.openIssue({ title: "Old: closed one", state: "closed" });
    github.state.pulls.push({
      number: 400,
      title: "Fix typo",
      body: "Fixes #2",
      headRefName: "web-2-typo",
      author: "a-contributor",
    });

    const run = async () => {
      let body: Record<string, unknown> = { projectId: ctx.project.id };
      for (let step = 0; step < 20; step++) {
        const response = await call(
          "POST",
          "/github-integration/import-issues",
          body,
        );
        const result = (await response.json()) as Record<string, unknown>;
        if (response.status === 200) return result;
        expect(response.status).toBe(202);
        body = { projectId: ctx.project.id, runId: result.runId };
      }
      throw new Error("import did not finish");
    };

    await run();
    const tasks = await db.query.taskTable.findMany({
      where: eq(schema.taskTable.projectId, ctx.project.id),
    });
    expect(tasks.map((row) => row.title).sort()).toEqual([
      "Old: slow images",
      "Old: typo in footer",
    ]);
    const slow = tasks.find((row) => row.title === "Old: slow images");
    expect(slow?.priority).toBe("high");
    const comments = await db.query.activityTable.findMany({
      where: eq(schema.activityTable.taskId, slow?.id ?? ""),
    });
    expect(comments.map((comment) => comment.content)).toContain(
      "Seen on mobile too",
    );

    await run();
    const again = await db.query.taskTable.findMany({
      where: eq(schema.taskTable.projectId, ctx.project.id),
    });
    expect(again).toHaveLength(2);
  });

  it("stops syncing in both directions after disconnecting", async () => {
    const removed = await call(
      "DELETE",
      `/github-integration/project/${ctx.project.id}`,
    );
    expect(removed.status).toBe(200);

    await createTask("After disconnect");
    // Give the event plugins time to (not) act.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(
      github.state.calls.filter((entry) => entry.endsWith("/issues")),
    ).toEqual([]);

    const issue = github.openIssue({ title: "After disconnect on GitHub" });
    await webhook("issues", {
      action: "opened",
      issue: github.issueJson(issue),
    });
    expect(await taskForIssue(issue.number)).toBeNull();
  });
});
