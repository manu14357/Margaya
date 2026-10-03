import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";
import type { CommentVisibility } from "@/types/publication";

// Public comments in the app: the project's recent list, a comment's
// visibility, a moderator's delete and per-board blocks.

export async function listProjectPublicComments(
  projectId: string,
  cursor?: string,
  signal?: AbortSignal,
) {
  const response = await client.publication.project[":projectId"].comments.$get(
    { param: { projectId }, query: cursor ? { cursor } : {} },
    { init: { signal } },
  );
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export async function setCommentVisibility(
  commentId: string,
  visibility: CommentVisibility,
) {
  const response = await client.publication.comment[
    ":commentId"
  ].visibility.$patch({ param: { commentId }, json: { visibility } });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export async function moderatorDeleteComment(commentId: string) {
  const response = await client.publication.comment[":commentId"].$delete({
    param: { commentId },
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export async function listPublicBoardBlocks(
  projectId: string,
  signal?: AbortSignal,
) {
  const response = await client.publication.project[":projectId"].blocks.$get(
    { param: { projectId } },
    { init: { signal } },
  );
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export async function blockPublicBoardParticipant(
  projectId: string,
  userId: string,
  hideComments: boolean,
) {
  const response = await client.publication.project[":projectId"].blocks[
    ":userId"
  ].$put({ param: { projectId, userId }, json: { hideComments } });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export async function unblockPublicBoardParticipant(
  projectId: string,
  userId: string,
) {
  const response = await client.publication.project[":projectId"].blocks[
    ":userId"
  ].$delete({ param: { projectId, userId } });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export async function getTaskVotes(taskId: string, signal?: AbortSignal) {
  const response = await client.publication.task[":taskId"].votes.$get(
    { param: { taskId } },
    { init: { signal } },
  );
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}
