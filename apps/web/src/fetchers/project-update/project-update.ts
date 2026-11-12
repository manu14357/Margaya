import { client } from "@margaya/libs";
import type { InferRequestType, InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

// Project status updates (/api/project-update/*): the timeline, posting,
// drafting, comments, reactions, following and the weekly reminder.

type Api = (typeof client)["project-update"];

export type ProjectUpdateList = InferResponseType<
  Api["project"][":projectId"]["$get"],
  200
>;
export type ProjectUpdate = ProjectUpdateList["updates"][number];
export type ProjectUpdateDetail = InferResponseType<Api[":id"]["$get"], 200>;
export type ProjectUpdateComment = ProjectUpdateDetail["comments"][number];
export type ProjectUpdateDraft = InferResponseType<
  Api["project"][":projectId"]["draft"]["$post"],
  200
>;
export type ProjectUpdateFacts = ProjectUpdateDraft["facts"];
export type ProjectUpdateHealth = ProjectUpdate["health"];
export type ProjectUpdateFollow = InferResponseType<
  Api["project"][":projectId"]["follow"]["$get"],
  200
>;
export type ProjectUpdateReminder = InferResponseType<
  Api["project"][":projectId"]["reminder"]["$get"],
  200
>;
export type LatestProjectUpdates = InferResponseType<
  Api["workspace"][":workspaceId"]["latest"]["$get"],
  200
>;
export type CreateProjectUpdateInput = InferRequestType<
  Api["project"][":projectId"]["$post"]
>["json"];
export type EditProjectUpdateInput = InferRequestType<
  Api[":id"]["$patch"]
>["json"];
export type ProjectUpdateReactionKey = InferRequestType<
  Api[":id"]["reaction"][":emoji"]["$put"]
>["param"]["emoji"];

async function read<T>(response: {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}): Promise<T> {
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return (await response.json()) as T;
}

const api = () => client["project-update"];

export async function listProjectUpdates(
  projectId: string,
  cursor?: string,
): Promise<ProjectUpdateList> {
  return read(
    await api().project[":projectId"].$get({
      param: { projectId },
      query: cursor ? { cursor } : {},
    }),
  );
}

export async function getProjectUpdate(
  id: string,
): Promise<ProjectUpdateDetail> {
  return read(await api()[":id"].$get({ param: { id } }));
}

export async function createProjectUpdate(
  projectId: string,
  json: CreateProjectUpdateInput,
): Promise<ProjectUpdate> {
  return read(
    await api().project[":projectId"].$post({ param: { projectId }, json }),
  );
}

export async function editProjectUpdate(
  id: string,
  json: EditProjectUpdateInput,
): Promise<ProjectUpdate> {
  return read(await api()[":id"].$patch({ param: { id }, json }));
}

export async function deleteProjectUpdate(id: string) {
  return read<{ id: string; deleted: true }>(
    await api()[":id"].$delete({ param: { id } }),
  );
}

export async function draftProjectUpdate(
  projectId: string,
  json: { useAi: boolean; locale?: string },
): Promise<ProjectUpdateDraft> {
  return read(
    await api().project[":projectId"].draft.$post({
      param: { projectId },
      json,
    }),
  );
}

export async function addProjectUpdateComment(id: string, content: string) {
  return read<ProjectUpdateComment>(
    await api()[":id"].comment.$post({ param: { id }, json: { content } }),
  );
}

export async function deleteProjectUpdateComment(commentId: string) {
  return read<{ id: string; deleted: true }>(
    await api().comment[":commentId"].$delete({ param: { commentId } }),
  );
}

export async function setProjectUpdateReaction(
  id: string,
  emoji: ProjectUpdateReactionKey,
  add: boolean,
) {
  const route = api()[":id"].reaction[":emoji"];
  const input = { param: { id, emoji } };
  return read<ProjectUpdate["reactions"]>(
    add ? await route.$put(input) : await route.$delete(input),
  );
}

export async function getProjectUpdateFollow(
  projectId: string,
): Promise<ProjectUpdateFollow> {
  return read(
    await api().project[":projectId"].follow.$get({ param: { projectId } }),
  );
}

export async function setProjectUpdateFollow(
  projectId: string,
  following: boolean,
): Promise<ProjectUpdateFollow> {
  return read(
    await api().project[":projectId"].follow.$put({
      param: { projectId },
      json: { following },
    }),
  );
}

export async function getProjectUpdateReminder(
  projectId: string,
): Promise<ProjectUpdateReminder> {
  return read(
    await api().project[":projectId"].reminder.$get({ param: { projectId } }),
  );
}

export async function setProjectUpdateReminder(
  projectId: string,
  json: { enabled: boolean; weekday?: number },
): Promise<ProjectUpdateReminder> {
  return read(
    await api().project[":projectId"].reminder.$put({
      param: { projectId },
      json,
    }),
  );
}

export async function getLatestProjectUpdates(
  workspaceId: string,
): Promise<LatestProjectUpdates> {
  return read(
    await api().workspace[":workspaceId"].latest.$get({
      param: { workspaceId },
      query: {},
    }),
  );
}
