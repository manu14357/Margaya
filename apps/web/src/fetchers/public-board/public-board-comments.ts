import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

// A public task's comments (oldest first) and my own comment edits.

export async function listPublicBoardComments(
  token: string,
  number: number,
  cursor?: string,
  signal?: AbortSignal,
) {
  const response = await client["public-board"][":token"].tasks[
    ":number"
  ].comments.$get(
    {
      param: { token, number: String(number) },
      query: cursor ? { cursor } : {},
    },
    { init: { signal } },
  );
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export async function createPublicBoardComment(
  token: string,
  number: number,
  content: string,
) {
  const response = await client["public-board"][":token"].tasks[
    ":number"
  ].comments.$post({
    param: { token, number: String(number) },
    json: { content },
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export async function updatePublicBoardComment(
  token: string,
  commentId: string,
  content: string,
) {
  const response = await client["public-board"][":token"].comments[
    ":commentId"
  ].$patch({ param: { token, commentId }, json: { content } });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export async function deletePublicBoardComment(
  token: string,
  commentId: string,
) {
  const response = await client["public-board"][":token"].comments[
    ":commentId"
  ].$delete({ param: { token, commentId } });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}
