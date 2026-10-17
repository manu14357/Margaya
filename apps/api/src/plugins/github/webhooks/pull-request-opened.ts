import {
  findHandoffTaskForPullRequest,
  syncHandoffPullRequest,
} from "../../../coding-agent/handoffs";
import { publishEvent } from "../../../events";
import type { GitHubConfig } from "../config";
import { createExternalLink, findExternalLink } from "../services/link-manager";
import {
  findAllIntegrationsByRepo,
  findTaskById,
  findTaskByNumber,
  isTaskInFinalState,
  updateTaskStatus,
} from "../services/task-service";
import { extractTaskNumber } from "../utils/branch-matcher";
import { resolveTargetStatus } from "../utils/resolve-column";

type PROpenedPayload = {
  action: string;
  pull_request: {
    number: number;
    title: string;
    body: string | null;
    html_url: string;
    state: string;
    draft: boolean;
    merged: boolean;
    head: {
      ref: string;
    };
    user: { login: string } | null;
  };
  installation?: { id: number };
  repository: {
    id: number;
    owner: { login: string };
    name: string;
  };
};

export async function handlePullRequestOpened(payload: PROpenedPayload) {
  const { pull_request } = payload;

  const integrations = await findAllIntegrationsByRepo(payload);

  for (const integration of integrations) {
    if (!integration.project) {
      continue;
    }

    const config = JSON.parse(integration.config) as GitHubConfig;
    const projectSlug = integration.project.slug;
    const branchName = pull_request.head.ref;

    // A pull request for a coding-agent handoff names the handoff issue
    // ("Closes #12"), which is not a task number.
    const handoffTaskId = await findHandoffTaskForPullRequest(integration.id, {
      title: pull_request.title,
      body: pull_request.body,
      branch: branchName,
    });
    const handoffTask = handoffTaskId
      ? await findTaskById(handoffTaskId)
      : null;

    const taskNumber = handoffTask
      ? null
      : extractTaskNumber(
          branchName,
          pull_request.title,
          pull_request.body ?? undefined,
          config,
          projectSlug,
        );

    if (!handoffTask && taskNumber === null) {
      continue;
    }

    const task =
      handoffTask?.projectId === integration.projectId
        ? handoffTask
        : taskNumber === null
          ? null
          : await findTaskByNumber(integration.projectId, taskNumber);

    if (!task) {
      continue;
    }

    const existingLink = await findExternalLink(
      integration.id,
      "pull_request",
      pull_request.number.toString(),
    );

    const snapshot = {
      number: pull_request.number,
      url: pull_request.html_url,
      title: pull_request.title,
      draft: Boolean(pull_request.draft),
      state: "open" as const,
      merged: false,
    };

    if (existingLink) {
      await syncHandoffPullRequest({
        integrationId: integration.id,
        taskId: existingLink.taskId,
        pr: snapshot,
      });
      continue;
    }

    await createExternalLink({
      taskId: task.id,
      integrationId: integration.id,
      resourceType: "pull_request",
      externalId: pull_request.number.toString(),
      url: pull_request.html_url,
      title: pull_request.title,
      metadata: {
        state: pull_request.state,
        draft: pull_request.draft,
        merged: pull_request.merged,
        branch: branchName,
        author: pull_request.user?.login,
      },
    });

    await syncHandoffPullRequest({
      integrationId: integration.id,
      taskId: task.id,
      pr: snapshot,
    });

    const targetStatus = await resolveTargetStatus(
      integration.projectId,
      "pr_opened",
      config.statusTransitions?.onPROpen || "in-review",
    );

    const isTaskFinal = await isTaskInFinalState(task);

    if (task.status !== targetStatus && !isTaskFinal) {
      const statusResult = await updateTaskStatus(task.id, targetStatus);
      if (
        statusResult.applied &&
        statusResult.before.status !== statusResult.after.status
      ) {
        await publishEvent("task.status_changed", {
          taskId: statusResult.after.id,
          projectId: statusResult.after.projectId,
          userId: null,
          oldStatus: statusResult.before.status,
          newStatus: statusResult.after.status,
          title: statusResult.after.title,
          assigneeId: statusResult.after.userId,
          type: "status_changed",
        });
      }
    }

    return;
  }
}
