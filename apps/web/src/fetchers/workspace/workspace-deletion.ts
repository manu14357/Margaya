import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

// Delayed workspace deletion: read the state, schedule it, cancel it.

async function ensureOk(response: Response) {
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
}

export async function getWorkspaceDeletion(workspaceId: string) {
  const response = await client.workspace[":workspaceId"].deletion.$get({
    param: { workspaceId },
  });
  await ensureOk(response);
  return response.json();
}

export async function scheduleWorkspaceDeletion(workspaceId: string) {
  const response = await client.workspace[":workspaceId"].deletion.$post({
    param: { workspaceId },
  });
  await ensureOk(response);
  return response.json();
}

export async function cancelWorkspaceDeletion(workspaceId: string) {
  const response = await client.workspace[":workspaceId"].deletion.$delete({
    param: { workspaceId },
  });
  await ensureOk(response);
  return response.json();
}

export type WorkspaceDeletion = Awaited<
  ReturnType<typeof getWorkspaceDeletion>
>;
