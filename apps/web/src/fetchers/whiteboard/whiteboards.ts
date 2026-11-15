import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import type { WhiteboardListFilters } from "@/types/whiteboard";
import { responseError } from "./response-error";

// A project's whiteboards (/api/whiteboard/*): the list, one board, and its
// lifecycle (rename, duplicate, lock, archive, trash, publish).

type Api = (typeof client)["whiteboard"];

export type CreateWhiteboardInput = InferRequestType<Api["$post"]>["json"];
export type UpdateWhiteboardInput = InferRequestType<
  Api[":id"]["$patch"]
>["json"];

const api = () => client.whiteboard;

/** The project's boards, newest updated first; `q` matches title and text. */
export async function listWhiteboards(
  projectId: string,
  { archived, q }: WhiteboardListFilters,
) {
  const search = q.trim();
  const response = await api().$get({
    query: {
      projectId,
      archived: archived ? "true" : "false",
      ...(search ? { q: search } : {}),
    },
  });
  if (!response.ok) throw await responseError(response);
  return response.json();
}

/** Boards of every project the caller can see, each with its project. */
export async function listWorkspaceWhiteboards(
  workspaceId: string,
  { archived, q }: WhiteboardListFilters,
) {
  const search = q.trim();
  const response = await api().workspace[":workspaceId"].$get({
    param: { workspaceId },
    query: {
      archived: archived ? "true" : "false",
      ...(search ? { q: search } : {}),
    },
  });
  if (!response.ok) throw await responseError(response);
  return response.json();
}

export async function getWhiteboard(whiteboardId: string) {
  const response = await api()[":id"].$get({ param: { id: whiteboardId } });
  if (!response.ok) throw await responseError(response);
  return response.json();
}

export async function createWhiteboard(json: CreateWhiteboardInput) {
  const response = await api().$post({ json });
  if (!response.ok) throw await responseError(response);
  return response.json();
}

export async function updateWhiteboard(
  whiteboardId: string,
  json: UpdateWhiteboardInput,
) {
  const response = await api()[":id"].$patch({
    param: { id: whiteboardId },
    json,
  });
  if (!response.ok) throw await responseError(response);
  return response.json();
}

/** A copy of the board's content; the caller names the copy. */
export async function duplicateWhiteboard(whiteboardId: string, title: string) {
  const response = await api()[":id"].duplicate.$post({
    param: { id: whiteboardId },
    json: { title },
  });
  if (!response.ok) throw await responseError(response);
  return response.json();
}

/** Moves an archived board to the project's trash. */
export async function deleteWhiteboard(whiteboardId: string) {
  const response = await api()[":id"].$delete({ param: { id: whiteboardId } });
  if (!response.ok) throw await responseError(response);
  return response.json();
}

export async function lockWhiteboard(whiteboardId: string) {
  const response = await api()[":id"].lock.$post({
    param: { id: whiteboardId },
  });
  if (!response.ok) throw await responseError(response);
  return response.json();
}

export async function unlockWhiteboard(whiteboardId: string) {
  const response = await api()[":id"].lock.$delete({
    param: { id: whiteboardId },
  });
  if (!response.ok) throw await responseError(response);
  return response.json();
}

export async function archiveWhiteboard(whiteboardId: string) {
  const response = await api()[":id"].archive.$post({
    param: { id: whiteboardId },
  });
  if (!response.ok) throw await responseError(response);
  return response.json();
}

export async function unarchiveWhiteboard(whiteboardId: string) {
  const response = await api()[":id"].unarchive.$post({
    param: { id: whiteboardId },
  });
  if (!response.ok) throw await responseError(response);
  return response.json();
}

/** A new read-only public link (each publish issues a new token). */
export async function publishWhiteboard(whiteboardId: string) {
  const response = await api()[":id"].publication.$post({
    param: { id: whiteboardId },
  });
  if (!response.ok) throw await responseError(response);
  return response.json();
}

/** Revokes the public link at once. */
export async function unpublishWhiteboard(whiteboardId: string) {
  const response = await api()[":id"].publication.$delete({
    param: { id: whiteboardId },
  });
  if (!response.ok) throw await responseError(response);
  return response.json();
}
