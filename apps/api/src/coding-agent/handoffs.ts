import { and, desc, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import {
  codingHandoffTable,
  integrationTable,
  userTable,
} from "../database/schema";
import { publishEvent } from "../events";
import {
  type GiteaConfig,
  normalizeGiteaBaseUrl,
} from "../plugins/gitea/config";
import { createGiteaClient } from "../plugins/gitea/utils/gitea-api";
import {
  type GitHubConfig,
  hasVerifiedGitHubBinding,
} from "../plugins/github/config";
import {
  getGithubApp,
  getVerifiedInstallationOctokit,
} from "../plugins/github/utils/github-app";
import type { CodingAgentProvider } from "./profiles";

// Handoffs: the issue a task was sent through, and the pull request that
// came back. Issues go out only through the existing integration clients
// (the GitHub App installation or the Gitea token of the project). The
// pull-request state comes back through the existing webhooks.

export type HandoffState =
  | "issue_created"
  | "working"
  | "ready_for_review"
  | "merged"
  | "closed";

export type Repository = {
  integrationId: string;
  provider: CodingAgentProvider;
  name: string;
  ready: boolean;
};

type IntegrationRow = typeof integrationTable.$inferSelect;

function parseConfig<T>(integration: IntegrationRow): T | null {
  try {
    return JSON.parse(integration.config) as T;
  } catch {
    return null;
  }
}

/** Whether the integration can open issues right now. */
function isReady(integration: IntegrationRow): boolean {
  if (integration.type === "github") {
    const config = parseConfig<GitHubConfig>(integration);
    return Boolean(
      config && getGithubApp() && hasVerifiedGitHubBinding(config),
    );
  }
  const config = parseConfig<GiteaConfig>(integration);
  return Boolean(config?.baseUrl && config.accessToken);
}

function repositoryOf(integration: IntegrationRow): Repository | null {
  if (integration.type !== "github" && integration.type !== "gitea") {
    return null;
  }
  const config = parseConfig<{
    repositoryOwner?: string;
    repositoryName?: string;
  }>(integration);
  if (!config?.repositoryOwner || !config.repositoryName) return null;
  return {
    integrationId: integration.id,
    provider: integration.type,
    name: `${config.repositoryOwner}/${config.repositoryName}`,
    ready: isReady(integration),
  };
}

/** The project's connected GitHub and Gitea repositories (no secrets). */
export async function projectRepositories(
  projectId: string,
): Promise<Repository[]> {
  const rows = await db
    .select()
    .from(integrationTable)
    .where(
      and(
        eq(integrationTable.projectId, projectId),
        inArray(integrationTable.type, ["github", "gitea"]),
        eq(integrationTable.isActive, true),
      ),
    );
  return rows.flatMap((row) => {
    const repository = repositoryOf(row);
    return repository ? [repository] : [];
  });
}

export async function loadIntegrationForProject(
  projectId: string,
  integrationId: string,
): Promise<IntegrationRow> {
  const [integration] = await db
    .select()
    .from(integrationTable)
    .where(
      and(
        eq(integrationTable.id, integrationId),
        eq(integrationTable.projectId, projectId),
        inArray(integrationTable.type, ["github", "gitea"]),
        eq(integrationTable.isActive, true),
      ),
    )
    .limit(1);
  if (!integration) {
    throw new HTTPException(404, { message: "Repository not found" });
  }
  return integration;
}

/** Values of the integration that must never appear in an issue. */
export function integrationSecrets(integration: IntegrationRow): string[] {
  const config = parseConfig<Record<string, unknown>>(integration) ?? {};
  return ["accessToken", "webhookSecret", "token", "secret"]
    .map((key) => config[key])
    .filter((value): value is string => typeof value === "string");
}

export function integrationBranchConfig(integration: IntegrationRow): {
  branchPattern?: string;
  customBranchRegex?: string;
} {
  const config = parseConfig<GitHubConfig | GiteaConfig>(integration);
  return {
    branchPattern: config?.branchPattern,
    customBranchRegex: config?.customBranchRegex,
  };
}

export type OpenedIssue = {
  number: number;
  url: string;
  assigned: boolean | null;
};

// Indirection so tests replace the forge calls; production always goes
// through the integration clients below.
export const forgeClients = {
  async openGitHubIssue(
    config: GitHubConfig,
    input: { title: string; body: string; assignee: string | null },
  ): Promise<OpenedIssue> {
    const octokit = await getVerifiedInstallationOctokit(config);
    const { data } = await octokit.rest.issues.create({
      owner: config.repositoryOwner,
      repo: config.repositoryName,
      title: input.title,
      body: input.body,
    });
    let assigned: boolean | null = null;
    if (input.assignee) {
      try {
        const result = await octokit.rest.issues.addAssignees({
          owner: config.repositoryOwner,
          repo: config.repositoryName,
          issue_number: data.number,
          assignees: [input.assignee],
        });
        // GitHub silently drops assignees it cannot assign.
        assigned = (result.data.assignees ?? []).some(
          (user) =>
            user.login.toLowerCase() === input.assignee?.toLowerCase() ||
            user.login
              .toLowerCase()
              .startsWith(`${input.assignee?.toLowerCase()}`),
        );
      } catch {
        assigned = false;
      }
    }
    return { number: data.number, url: data.html_url, assigned };
  },

  async openGiteaIssue(
    config: GiteaConfig,
    input: { title: string; body: string },
  ): Promise<OpenedIssue> {
    const client = createGiteaClient(config);
    const issue = await client.createIssue(
      config.repositoryOwner,
      config.repositoryName,
      { title: input.title, body: input.body },
    );
    return { number: issue.number, url: issue.html_url, assigned: null };
  },
};

/** Opens the handoff issue through the project's integration. */
export async function openIssue(
  integration: IntegrationRow,
  input: { title: string; body: string; assignee: string | null },
): Promise<OpenedIssue> {
  try {
    if (integration.type === "github") {
      const config = parseConfig<GitHubConfig>(integration);
      if (!config || !getGithubApp() || !hasVerifiedGitHubBinding(config)) {
        throw new HTTPException(409, {
          message: "The GitHub integration needs to be verified first",
        });
      }
      return await forgeClients.openGitHubIssue(config, input);
    }
    const config = parseConfig<GiteaConfig>(integration);
    if (!config?.baseUrl || !config.accessToken) {
      throw new HTTPException(409, {
        message: "The Gitea integration is not set up",
      });
    }
    return await forgeClients.openGiteaIssue(
      { ...config, baseUrl: normalizeGiteaBaseUrl(config.baseUrl) },
      { title: input.title, body: input.body },
    );
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    // Forge errors can carry response bodies; keep them out of the answer.
    console.error("[coding-agent] Opening the issue failed", {
      integrationId: integration.id,
      provider: integration.type,
    });
    throw new HTTPException(502, {
      message: "The repository did not accept the issue",
    });
  }
}

export type HandoffRow = typeof codingHandoffTable.$inferSelect;

/** The task's handoffs, newest first, with the sender's name. */
export async function listTaskHandoffs(taskId: string) {
  return db
    .select({
      handoff: codingHandoffTable,
      senderName: userTable.name,
    })
    .from(codingHandoffTable)
    .leftJoin(userTable, eq(userTable.id, codingHandoffTable.createdBy))
    .where(eq(codingHandoffTable.taskId, taskId))
    .orderBy(desc(codingHandoffTable.createdAt))
    .limit(20);
}

async function announce(
  handoff: Pick<HandoffRow, "taskId" | "projectId" | "workspaceId" | "id">,
) {
  await publishEvent("task.coding_handoff_updated", {
    taskId: handoff.taskId,
    projectId: handoff.projectId,
    workspaceId: handoff.workspaceId,
    handoffId: handoff.id,
  });
}

export async function recordHandoff(
  values: typeof codingHandoffTable.$inferInsert,
): Promise<HandoffRow> {
  const [row] = await db.insert(codingHandoffTable).values(values).returning();
  if (!row) throw new Error("Failed to record the handoff");
  await announce(row);
  return row;
}

// Issue references a pull request may carry: "#12", ".../issues/12", and
// the branch names coding agents use ("issue-12", "fix-12").
function referencedIssueNumbers(input: {
  title: string;
  body: string | null;
  branch: string;
}): Set<number> {
  const numbers = new Set<number>();
  const text = `${input.title}\n${input.body ?? ""}`;
  for (const match of text.matchAll(/(?:^|[^\w&/])#(\d{1,9})\b/g)) {
    numbers.add(Number(match[1]));
  }
  for (const match of text.matchAll(/\/issues\/(\d{1,9})\b/g)) {
    numbers.add(Number(match[1]));
  }
  for (const match of input.branch.matchAll(
    /(?:issue|fix)[-_/](\d{1,9})\b/gi,
  )) {
    numbers.add(Number(match[1]));
  }
  return numbers;
}

/**
 * The task of a handoff issue that a pull request references, so the
 * existing link-and-status flow can use it. Checked before the task-number
 * patterns: "Closes #12" names the issue, not task 12.
 */
export async function findHandoffTaskForPullRequest(
  integrationId: string,
  pr: { title: string; body: string | null; branch: string },
): Promise<string | null> {
  const numbers = [...referencedIssueNumbers(pr)].filter(
    (n) => Number.isSafeInteger(n) && n > 0,
  );
  if (numbers.length === 0) return null;
  const [row] = await db
    .select({ taskId: codingHandoffTable.taskId })
    .from(codingHandoffTable)
    .where(
      and(
        eq(codingHandoffTable.integrationId, integrationId),
        inArray(codingHandoffTable.issueNumber, numbers),
      ),
    )
    .orderBy(desc(codingHandoffTable.createdAt))
    .limit(1);
  return row?.taskId ?? null;
}

export type PullRequestSnapshot = {
  number: number;
  url: string;
  title: string;
  draft: boolean;
  state: "open" | "closed";
  merged: boolean;
};

/** The handoff step a pull request's state means. */
export function stateOfPullRequest(pr: PullRequestSnapshot): HandoffState {
  if (pr.state === "closed") return pr.merged ? "merged" : "closed";
  return pr.draft ? "working" : "ready_for_review";
}

/**
 * Moves the task's handoff along when a pull request linked to the task
 * changes. A task without a handoff is left alone. Nothing here changes the
 * task itself: status moves stay with the integration's own rules.
 */
export async function syncHandoffPullRequest(input: {
  integrationId: string;
  taskId: string;
  pr: PullRequestSnapshot;
}): Promise<void> {
  const { integrationId, taskId, pr } = input;
  const handoffs = await db
    .select()
    .from(codingHandoffTable)
    .where(
      and(
        eq(codingHandoffTable.integrationId, integrationId),
        eq(codingHandoffTable.taskId, taskId),
      ),
    )
    .orderBy(desc(codingHandoffTable.createdAt))
    .limit(10);
  const handoff =
    handoffs.find((row) => row.prNumber === pr.number) ??
    handoffs.find((row) => row.prNumber === null) ??
    // A new pull request after the last one was closed unmerged.
    handoffs.find((row) => row.state === "closed");
  if (!handoff) return;

  const now = new Date();
  const state = stateOfPullRequest(pr);
  const finished = state === "merged" || state === "closed";
  const next = {
    prNumber: pr.number,
    prUrl: pr.url,
    prTitle: pr.title.slice(0, 300),
    state,
    workingAt: handoff.workingAt ?? now,
    readyAt:
      state === "ready_for_review" || state === "merged"
        ? (handoff.readyAt ?? now)
        : state === "working"
          ? null
          : handoff.readyAt,
    finishedAt: finished ? (handoff.finishedAt ?? now) : null,
  };
  const unchanged =
    handoff.prNumber === next.prNumber &&
    handoff.state === next.state &&
    handoff.prTitle === next.prTitle &&
    handoff.prUrl === next.prUrl;
  if (unchanged) return;
  await db
    .update(codingHandoffTable)
    .set(next)
    .where(eq(codingHandoffTable.id, handoff.id));
  await announce(handoff);
}
