import { client } from "@margaya/libs";
import type { InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

const access = client.project[":id"].access;

export type ProjectAccess = InferResponseType<(typeof access)["$get"], 200>;
export type ProjectVisibility = ProjectAccess["visibility"];

/** Every access route answers the project's access state. */
async function read(response: Response): Promise<ProjectAccess> {
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return (await response.json()) as ProjectAccess;
}

export async function getProjectAccess(projectId: string) {
  return read(await access.$get({ param: { id: projectId } }));
}

export async function updateProjectVisibility(
  projectId: string,
  visibility: ProjectVisibility,
) {
  return read(
    await access.visibility.$put({
      param: { id: projectId },
      json: { visibility },
    }),
  );
}

export async function addProjectMember(
  projectId: string,
  userId: string,
  role: string,
) {
  return read(
    await access.members.$post({
      param: { id: projectId },
      json: { userId, role },
    }),
  );
}

export async function updateProjectMemberRole(
  projectId: string,
  userId: string,
  role: string,
) {
  return read(
    await access.members[":userId"].$patch({
      param: { id: projectId, userId },
      json: { role },
    }),
  );
}

export async function removeProjectMember(projectId: string, userId: string) {
  return read(
    await access.members[":userId"].$delete({
      param: { id: projectId, userId },
    }),
  );
}
