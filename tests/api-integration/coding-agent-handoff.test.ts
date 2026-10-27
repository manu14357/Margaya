import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAiGatewayState } from "../../apps/api/src/ai/gateway";
import { setFakeResponder } from "../../apps/api/src/ai/provider/fake";
import { settleAuditWrites } from "../../apps/api/src/audit-log/record";
import { HANDOFF_MARKER } from "../../apps/api/src/coding-agent/marker";
import db, { schema } from "../../apps/api/src/database";
import {
  aiUsageTable,
  auditLogTable,
  codingHandoffTable,
  externalLinkTable,
  projectMemberTable,
} from "../../apps/api/src/database/schema";
import { handleGiteaPullRequestClosed } from "../../apps/api/src/plugins/gitea/webhooks/pull-request-closed";
import { handleGiteaPullRequestOpened } from "../../apps/api/src/plugins/gitea/webhooks/pull-request-opened";
import { handleIssueOpened } from "../../apps/api/src/plugins/github/webhooks/issue-opened";
import { handlePullRequestClosed } from "../../apps/api/src/plugins/github/webhooks/pull-request-closed";
import { handlePullRequestOpened } from "../../apps/api/src/plugins/github/webhooks/pull-request-opened";
import { handlePullRequestReady } from "../../apps/api/src/plugins/github/webhooks/pull-request-ready";
import { resetRateLimitMemory } from "../../apps/api/src/utils/rate-limit";
import { resetTestDatabase } from "./helpers/database";
import { draftScene } from "./helpers/drafts";

// Coding-agent handoff (C4) with mocked GitHub and Gitea clients: issue
// templates and content, no secrets, the pull-request timeline from the
// existing webhooks, and permissions. No request leaves the process.

const forge = vi.hoisted(() => ({
  githubCreate: vi.fn(),
  githubAssign: vi.fn(),
  giteaCreate: vi.fn(),
}));

vi.mock("../../apps/api/src/plugins/github/utils/github-app", () => ({
  getGithubApp: () => ({ octokit: {} }),
  getVerifiedInstallationOctokit: async () => ({
    rest: {
      issues: {
        create: forge.githubCreate,
        addAssignees: forge.githubAssign,
      },
    },
  }),
  getInstallationOctokit: async () => {
    throw new Error("not in tests");
  },
}));

vi.mock("../../apps/api/src/plugins/gitea/utils/gitea-api", async (load) => {
  const actual =
    await load<
      typeof import("../../apps/api/src/plugins/gitea/utils/gitea-api")
    >();
  return {
    ...actual,
    createGiteaClient: () => ({ createIssue: forge.giteaCreate }),
  };
});

const GITEA_TOKEN = "gitea-access-token-0123456789";
const GITEA_SECRET = "gitea-webhook-secret-0123456789";
const TASK_TOKEN = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";

type Scene = Awaited<ReturnType<typeof draftScene>>;
type User = Scene["mia"];

beforeEach(async () => {
  await resetTestDatabase();
  resetRateLimitMemory();
  resetAiGatewayState();
  vi.clearAllMocks();
  forge.githubCreate.mockImplementation(async (input: { title: string }) => ({
    data: {
      number: 41,
      html_url: "https://github.com/acme/web/issues/41",
      title: input.title,
    },
  }));
  forge.githubAssign.mockResolvedValue({
    data: { assignees: [{ login: "Copilot" }] },
  });
  forge.giteaCreate.mockImplementation(
    async (_owner: string, _repo: string, input: { title: string }) => ({
      number: 7,
      html_url: "https://git.example.com/acme/api/issues/7",
      title: input.title,
      state: "open",
    }),
  );
});

afterEach(() => {
  delete process.env.MARGAYA_AI_ENABLED;
  delete process.env.MARGAYA_AI_PROVIDER;
  setFakeResponder(null);
});

let nextNumber = 10;

async function insertTask(
  projectId: string,
  title: string,
  description: string | null = null,
) {
  nextNumber += 1;
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId,
      title,
      description,
      status: "to-do",
      number: nextNumber,
    })
    .returning();
  if (!task) throw new Error("Failed to insert task");
  return task;
}

async function scene() {
  const s = await draftScene();
  const [github] = await db
    .insert(schema.integrationTable)
    .values({
      projectId: s.web.project.id,
      type: "github",
      config: JSON.stringify({
        repositoryOwner: "acme",
        repositoryName: "web",
        installationId: 10,
        repositoryId: 20,
        verifiedGithubAccountId: "30",
        verifiedByUserId: s.owner.id,
        branchPattern: "{slug}-{number}",
      }),
    })
    .returning();
  const [gitea] = await db
    .insert(schema.integrationTable)
    .values({
      projectId: s.api.project.id,
      type: "gitea",
      config: JSON.stringify({
        baseUrl: "https://git.example.com",
        accessToken: GITEA_TOKEN,
        webhookSecret: GITEA_SECRET,
        repositoryOwner: "acme",
        repositoryName: "api",
        branchPattern: "{slug}-{number}",
      }),
    })
    .returning();
  if (!github || !gitea) throw new Error("Failed to insert integrations");
  return { ...s, github, gitea };
}

type ProfileJson = {
  id: string;
  builtin: string | null;
  name: string;
  mention: string;
  assignee: string | null;
  enabled: boolean;
  providers: string[];
};

async function profiles(s: Scene, user: User) {
  return (
    await s.ok<{ profiles: ProfileJson[]; canManage: boolean }>(
      user,
      "GET",
      `/coding-agent/profiles?workspaceId=${s.workspaceId}`,
    )
  ).profiles;
}

function byBuiltin(list: ProfileJson[], key: string) {
  const profile = list.find((item) => item.builtin === key);
  if (!profile) throw new Error(`No ${key} profile`);
  return profile;
}

type SendJson = {
  handoff: { id: string; state: string; issueNumber: number };
  assigned: boolean | null;
};

function githubPayload(pr: {
  number: number;
  title: string;
  body?: string | null;
  branch?: string;
  draft?: boolean;
}) {
  return {
    action: "opened",
    pull_request: {
      number: pr.number,
      title: pr.title,
      body: pr.body ?? null,
      html_url: `https://github.com/acme/web/pull/${pr.number}`,
      state: "open",
      draft: pr.draft ?? false,
      merged: false,
      head: { ref: pr.branch ?? "copilot/some-work" },
      user: { login: "Copilot" },
    },
    installation: { id: 10 },
    repository: { id: 20, owner: { login: "acme" }, name: "web" },
  };
}

async function handoffOf(taskId: string) {
  const [row] = await db
    .select()
    .from(codingHandoffTable)
    .where(eq(codingHandoffTable.taskId, taskId));
  return row;
}

describe("Coding-agent profiles", () => {
  it("seeds the built-in templates once and lets managers add custom ones", async () => {
    const s = await scene();
    const first = await profiles(s, s.mia);
    expect(first.map((p) => p.builtin)).toEqual([
      "claude_code",
      "copilot",
      "codex",
    ]);
    expect(byBuiltin(first, "claude_code")).toMatchObject({
      mention: "@claude",
      providers: ["github", "gitea"],
    });
    // An assignee works on GitHub only; Gitea gets mentions only.
    expect(byBuiltin(first, "copilot")).toMatchObject({
      assignee: "Copilot",
      providers: ["github"],
    });
    expect(await profiles(s, s.mia)).toHaveLength(3);

    // Members cannot manage profiles; admins can.
    const denied = await s.as(s.mia)("POST", "/coding-agent/profiles", {
      workspaceId: s.workspaceId,
      name: "Runner",
      mention: "@runner",
    });
    expect(denied.status).toBe(403);
    const custom = await s.ok<ProfileJson>(
      s.ada,
      "POST",
      "/coding-agent/profiles",
      {
        workspaceId: s.workspaceId,
        name: "Runner",
        mention: "@runner please take {task} on {branch}",
      },
    );
    expect(custom.builtin).toBeNull();

    const empty = await s.as(s.ada)("POST", "/coding-agent/profiles", {
      workspaceId: s.workspaceId,
      name: "Nothing",
    });
    expect(empty.status).toBe(400);

    // Built-ins can be turned off, not deleted.
    const claude = byBuiltin(first, "claude_code");
    const builtinDelete = await s.as(s.ada)(
      "DELETE",
      `/coding-agent/profiles/${claude.id}?workspaceId=${s.workspaceId}`,
    );
    expect(builtinDelete.status).toBe(400);
    const off = await s.ok<ProfileJson>(
      s.ada,
      "PATCH",
      `/coding-agent/profiles/${claude.id}?workspaceId=${s.workspaceId}`,
      { enabled: false },
    );
    expect(off.enabled).toBe(false);
    await s.ok(
      s.ada,
      "DELETE",
      `/coding-agent/profiles/${custom.id}?workspaceId=${s.workspaceId}`,
    );

    // Another workspace's profile reads as missing.
    const foreign = await s.as(s.outsider)(
      "PATCH",
      `/coding-agent/profiles/${claude.id}?workspaceId=${s.outsiderWorkspaceId}`,
      { enabled: true },
    );
    expect([403, 404]).toContain(foreign.status);
    await settleAuditWrites();
    const audit = await db
      .select({ action: auditLogTable.action })
      .from(auditLogTable)
      .where(eq(auditLogTable.workspaceId, s.workspaceId));
    expect(audit.map((row) => row.action).sort()).toEqual([
      "coding_agent.profile_created",
      "coding_agent.profile_deleted",
      "coding_agent.profile_updated",
    ]);
  });
});

describe("Sending a task to a coding agent", () => {
  it("prepares a brief from what the sender may see, without secrets", async () => {
    const s = await scene();
    const task = await insertTask(
      s.web.project.id,
      "Fix login redirect",
      `Users land on a blank page.\nUse token ${TASK_TOKEN} for the staging API.\n\n## Acceptance criteria\n- Redirect goes to the dashboard\n- A test covers it`,
    );
    const related = await insertTask(s.web.project.id, "Session refactor");
    const secret = await insertTask(s.api.project.id, "Secret API work");
    await db
      .update(schema.projectTable)
      .set({ visibility: "restricted" })
      .where(eq(schema.projectTable.id, s.api.project.id));
    await db.insert(projectMemberTable).values({
      projectId: s.api.project.id,
      userId: s.mia.id,
      role: "member",
    });
    await db.insert(schema.taskRelationTable).values([
      {
        sourceTaskId: related.id,
        targetTaskId: task.id,
        relationType: "blocks",
      },
      {
        sourceTaskId: task.id,
        targetTaskId: secret.id,
        relationType: "related",
      },
    ]);

    const brief = await s.ok<{
      title: string;
      brief: string;
      aiUsed: boolean;
      relatedTasks: number;
    }>(s.mia, "POST", `/coding-agent/task/${task.id}/brief`, {
      integrationId: s.github.id,
    });
    expect(brief.aiUsed).toBe(false);
    expect(brief.title).toBe(`WEB-${task.number}: Fix login redirect`);
    expect(brief.brief).toContain("## Acceptance criteria");
    expect(brief.brief).toContain("- [ ] Redirect goes to the dashboard");
    expect(brief.brief).toContain("Session refactor (blocked by");
    // Another restricted project never goes into an issue, even when the
    // sender may see it.
    expect(brief.brief).not.toContain("Secret API work");
    expect(brief.brief).not.toContain(TASK_TOKEN);
    expect(brief.brief).toContain("[secret removed]");
    expect(brief.relatedTasks).toBe(1);
  });

  it("opens a GitHub issue with the Copilot template and records the handoff", async () => {
    const s = await scene();
    const task = await insertTask(s.web.project.id, "Fix login redirect");
    const copilot = byBuiltin(await profiles(s, s.mia), "copilot");
    const sent = await s.ok<SendJson>(
      s.mia,
      "POST",
      `/coding-agent/task/${task.id}/send`,
      {
        integrationId: s.github.id,
        profileId: copilot.id,
        title: "WEB-11: Fix login redirect",
        brief: `## Goal\nFix it. Do not leak ${TASK_TOKEN} or password=hunter22secret`,
      },
    );
    expect(sent.assigned).toBe(true);
    expect(sent.handoff).toMatchObject({
      state: "issue_created",
      issueNumber: 41,
    });

    expect(forge.githubCreate).toHaveBeenCalledTimes(1);
    const [issue] = forge.githubCreate.mock.calls[0] as [
      { owner: string; repo: string; title: string; body: string },
    ];
    expect(issue).toMatchObject({ owner: "acme", repo: "web" });
    expect(issue.body).toContain("## Goal");
    expect(issue.body).toContain(`\`web-${task.number}\``);
    expect(issue.body).toContain(HANDOFF_MARKER);
    expect(issue.body).not.toContain(TASK_TOKEN);
    expect(issue.body).not.toContain("hunter22secret");
    expect(issue.body).not.toContain("@claude");
    expect(forge.githubAssign).toHaveBeenCalledWith(
      expect.objectContaining({ issue_number: 41, assignees: ["Copilot"] }),
    );

    // The handoff issue is not imported back as a new task.
    await handleIssueOpened({
      action: "opened",
      issue: {
        number: 41,
        title: issue.title,
        body: issue.body,
        html_url: "https://github.com/acme/web/issues/41",
        user: { login: "someone" },
      },
      installation: { id: 10 },
      repository: {
        id: 20,
        owner: { login: "acme" },
        name: "web",
        full_name: "acme/web",
      },
    });
    const tasks = await db
      .select()
      .from(schema.taskTable)
      .where(eq(schema.taskTable.projectId, s.web.project.id));
    expect(tasks).toHaveLength(1);

    await settleAuditWrites();
    const [entry] = await db
      .select()
      .from(auditLogTable)
      .where(
        and(
          eq(auditLogTable.workspaceId, s.workspaceId),
          eq(auditLogTable.action, "coding_agent.handoff_sent"),
        ),
      );
    expect(entry).toMatchObject({ actorUserId: s.mia.id, actorName: "Mia" });

    const view = await s.ok<{
      handoffs: { sentBy: { name: string } | null; state: string }[];
      repositories: { name: string; provider: string; ready: boolean }[];
    }>(s.mia, "GET", `/coding-agent/task/${task.id}`);
    expect(view.handoffs[0]).toMatchObject({
      state: "issue_created",
      sentBy: { name: "Mia" },
    });
    expect(view.repositories).toEqual([
      expect.objectContaining({
        name: "acme/web",
        provider: "github",
        ready: true,
      }),
    ]);
    expect(JSON.stringify(view)).not.toContain(GITEA_TOKEN);
  });

  it("follows the pull request back: working, ready for review, merged", async () => {
    const s = await scene();
    const task = await insertTask(s.web.project.id, "Fix login redirect");
    const other = await insertTask(s.web.project.id, "Unrelated");
    const claude = byBuiltin(await profiles(s, s.mia), "claude_code");
    await s.ok<SendJson>(s.mia, "POST", `/coding-agent/task/${task.id}/send`, {
      integrationId: s.github.id,
      profileId: claude.id,
      title: "Fix login",
      brief: "## Goal\nFix it.",
    });
    const [issue] = forge.githubCreate.mock.calls[0] as [{ body: string }];
    expect(issue.body.startsWith("@claude Please work on this issue")).toBe(
      true,
    );

    // "Closes #41" names the handoff issue; issue 41 is not a task number
    // here, and an unrelated task number in the title must not win.
    await handlePullRequestOpened(
      githubPayload({
        number: 5,
        title: `Fix redirect (#${other.number})`,
        body: "Closes #41",
        draft: true,
      }),
    );
    expect(await handoffOf(task.id)).toMatchObject({
      state: "working",
      prNumber: 5,
    });
    const [link] = await db
      .select()
      .from(externalLinkTable)
      .where(eq(externalLinkTable.resourceType, "pull_request"));
    expect(link?.taskId).toBe(task.id);

    await handlePullRequestReady({
      action: "ready_for_review",
      pull_request: {
        number: 5,
        title: "Fix redirect",
        html_url: "https://github.com/acme/web/pull/5",
        draft: false,
      },
      installation: { id: 10 },
      repository: { id: 20, owner: { login: "acme" }, name: "web" },
    });
    const ready = await handoffOf(task.id);
    expect(ready?.state).toBe("ready_for_review");
    expect(ready?.readyAt).toBeInstanceOf(Date);

    await handlePullRequestClosed({
      action: "closed",
      pull_request: {
        number: 5,
        title: "Fix redirect",
        html_url: "https://github.com/acme/web/pull/5",
        state: "closed",
        merged: true,
        merged_at: new Date().toISOString(),
        head: { ref: "copilot/some-work" },
      },
      installation: { id: 10 },
      repository: { id: 20, owner: { login: "acme" }, name: "web" },
    });
    const merged = await handoffOf(task.id);
    expect(merged?.state).toBe("merged");
    expect(merged?.finishedAt).toBeInstanceOf(Date);
    // The other task was never touched.
    expect(await handoffOf(other.id)).toBeUndefined();
  });

  it("uses mention templates only on Gitea and keeps its token out", async () => {
    const s = await scene();
    const task = await insertTask(
      s.api.project.id,
      "Rate limit the API",
      `Do not paste ${GITEA_TOKEN} anywhere.`,
    );
    const list = await profiles(s, s.mia);
    const view = await s.ok<{ profiles: ProfileJson[] }>(
      s.mia,
      "GET",
      `/coding-agent/task/${task.id}`,
    );
    expect(view.profiles.map((p) => p.builtin)).toEqual([
      "claude_code",
      "copilot",
      "codex",
    ]);
    const prepared = await s.ok<{ brief: string }>(
      s.mia,
      "POST",
      `/coding-agent/task/${task.id}/brief`,
      { integrationId: s.gitea.id },
    );

    // Copilot (an assignee) does not work on Gitea.
    const copilot = await s.as(s.mia)(
      "POST",
      `/coding-agent/task/${task.id}/send`,
      {
        integrationId: s.gitea.id,
        profileId: byBuiltin(list, "copilot").id,
        title: "API-11",
        brief: prepared.brief,
      },
    );
    expect(copilot.status).toBe(400);

    await s.ok<SendJson>(s.mia, "POST", `/coding-agent/task/${task.id}/send`, {
      integrationId: s.gitea.id,
      profileId: byBuiltin(list, "codex").id,
      title: "API-11: Rate limit the API",
      brief: prepared.brief,
    });
    const [owner, repo, input] = forge.giteaCreate.mock.calls[0] as [
      string,
      string,
      { body: string },
    ];
    expect([owner, repo]).toEqual(["acme", "api"]);
    expect(input.body.startsWith("@codex ")).toBe(true);
    expect(input.body).not.toContain(GITEA_TOKEN);
    expect(input.body).not.toContain(GITEA_SECRET);

    const repository = {
      owner: { login: "acme" },
      name: "api",
      html_url: "https://git.example.com/acme/api",
    };
    await handleGiteaPullRequestOpened(
      {
        action: "opened",
        pull_request: {
          number: 3,
          title: "Rate limiting",
          body: "Fixes #7",
          html_url: "https://git.example.com/acme/api/pulls/3",
          state: "open",
          head: { ref: "codex/rate-limit" },
          user: { login: "bot" },
        },
        repository,
      },
      s.gitea.id,
    );
    expect((await handoffOf(task.id))?.state).toBe("ready_for_review");

    await handleGiteaPullRequestClosed(
      {
        action: "closed",
        pull_request: {
          number: 3,
          title: "Rate limiting",
          html_url: "https://git.example.com/acme/api/pulls/3",
          state: "closed",
          merged: false,
          merged_at: null,
          head: { ref: "codex/rate-limit" },
        },
        repository,
      },
      s.gitea.id,
    );
    const closed = await handoffOf(task.id);
    expect(closed?.state).toBe("closed");
    expect(closed?.finishedAt).toBeInstanceOf(Date);
  });

  it("needs task:update and hides restricted projects", async () => {
    const s = await scene();
    const task = await insertTask(s.web.project.id, "Fix login redirect");
    const codex = byBuiltin(await profiles(s, s.mia), "codex");
    const body = {
      integrationId: s.github.id,
      profileId: codex.id,
      title: "Fix",
      brief: "Fix it.",
    };

    const viewer = await s.as(s.vic)(
      "POST",
      `/coding-agent/task/${task.id}/send`,
      body,
    );
    expect(viewer.status).toBe(403);
    const viewerBrief = await s.as(s.vic)(
      "POST",
      `/coding-agent/task/${task.id}/brief`,
      {
        integrationId: s.github.id,
      },
    );
    expect(viewerBrief.status).toBe(403);
    // Viewers may read the timeline.
    const read = await s.as(s.vic)("GET", `/coding-agent/task/${task.id}`);
    expect(read.status).toBe(200);

    const outsider = await s.as(s.outsider)(
      "POST",
      `/coding-agent/task/${task.id}/send`,
      body,
    );
    expect([403, 404]).toContain(outsider.status);

    // A repository of another project is not reachable through this task.
    const wrongRepo = await s.as(s.mia)(
      "POST",
      `/coding-agent/task/${task.id}/send`,
      {
        ...body,
        integrationId: s.gitea.id,
      },
    );
    expect(wrongRepo.status).toBe(404);

    await db
      .update(schema.projectTable)
      .set({ visibility: "restricted" })
      .where(eq(schema.projectTable.id, s.web.project.id));
    const hidden = await s.as(s.mia)(
      "POST",
      `/coding-agent/task/${task.id}/send`,
      body,
    );
    expect(hidden.status).toBe(404);
    const hiddenView = await s.as(s.mia)(
      "GET",
      `/coding-agent/task/${task.id}`,
    );
    expect(hiddenView.status).toBe(404);
    expect(forge.githubCreate).not.toHaveBeenCalled();
  });

  it("condenses the brief through the AI gateway when asked", async () => {
    process.env.MARGAYA_AI_ENABLED = "true";
    process.env.MARGAYA_AI_PROVIDER = "fake";
    const s = await scene();
    await s.ok(s.owner, "PATCH", "/ai/settings", {
      workspaceId: s.workspaceId,
      enabled: true,
    });
    const task = await insertTask(
      s.web.project.id,
      "Fix login redirect",
      `Token ${TASK_TOKEN} must stay private.`,
    );
    const prompts: string[] = [];
    setFakeResponder((request) => {
      const last = request.messages.at(-1);
      prompts.push(typeof last?.content === "string" ? last.content : "");
      return { text: `## Goal\nFix the redirect. ${TASK_TOKEN}` };
    });
    const brief = await s.ok<{ brief: string; aiUsed: boolean }>(
      s.mia,
      "POST",
      `/coding-agent/task/${task.id}/brief`,
      { integrationId: s.github.id, useAi: true },
    );
    expect(brief.aiUsed).toBe(true);
    expect(brief.brief).toContain("Fix the redirect.");
    expect(brief.brief).not.toContain(TASK_TOKEN);
    expect(prompts.join("\n")).not.toContain(TASK_TOKEN);
    const usage = await db
      .select({ feature: aiUsageTable.feature })
      .from(aiUsageTable)
      .where(eq(aiUsageTable.workspaceId, s.workspaceId));
    expect(usage.map((row) => row.feature)).toContain("coding_handoff");

    // Viewers have no ai:use (and no task:update).
    const viewer = await s.as(s.vic)(
      "POST",
      `/coding-agent/task/${task.id}/brief`,
      {
        integrationId: s.github.id,
        useAi: true,
      },
    );
    expect(viewer.status).toBe(403);
  });
});
