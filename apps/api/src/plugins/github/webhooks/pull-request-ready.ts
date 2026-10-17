import { syncHandoffPullRequest } from "../../../coding-agent/handoffs";
import { findExternalLink, updateExternalLink } from "../services/link-manager";
import { findAllIntegrationsByRepo } from "../services/task-service";
import { parseLinkMetadata } from "../utils/parse-link-metadata";

type PRReadyPayload = {
  action: string;
  pull_request: {
    number: number;
    title: string;
    html_url: string;
    draft: boolean;
  };
  installation?: { id: number };
  repository: {
    id: number;
    owner: { login: string };
    name: string;
  };
};

/**
 * ready_for_review and converted_to_draft: keeps a linked pull request's
 * draft flag current, and with it a coding-agent handoff's timeline. The
 * task's status is not touched here.
 */
export async function handlePullRequestReady(payload: PRReadyPayload) {
  const { pull_request } = payload;
  const integrations = await findAllIntegrationsByRepo(payload);
  for (const integration of integrations) {
    const link = await findExternalLink(
      integration.id,
      "pull_request",
      pull_request.number.toString(),
    );
    if (!link) continue;
    const metadata = parseLinkMetadata(link.metadata, {
      externalLinkId: link.id,
      source: "pull_request_ready",
    });
    await updateExternalLink(link.id, {
      metadata: { ...metadata, draft: pull_request.draft },
    });
    await syncHandoffPullRequest({
      integrationId: integration.id,
      taskId: link.taskId,
      pr: {
        number: pull_request.number,
        url: pull_request.html_url,
        title: pull_request.title,
        draft: pull_request.draft,
        state: "open",
        merged: false,
      },
    });
    return;
  }
}
