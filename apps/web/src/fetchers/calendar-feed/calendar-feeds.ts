import { client } from "@margaya/libs";
import type { InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

// The caller's own calendar subscription feeds. The URL comes back only from
// a create (or regenerate) call; lists carry the token's first characters.

export type CalendarFeed = InferResponseType<
  (typeof client)["calendar-feed"]["workspace"][":workspaceId"]["$get"],
  200
>[number];

export type CreatedCalendarFeed = InferResponseType<
  (typeof client)["calendar-feed"]["workspace"][":workspaceId"]["$post"],
  200
>;

export type WorkspaceFeedKind = "my_tasks" | "planning";

async function ok(response: Response) {
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
}

export async function listCalendarFeeds(workspaceId: string) {
  const response = await client["calendar-feed"].workspace[":workspaceId"].$get(
    { param: { workspaceId } },
  );
  await ok(response);
  return (await response.json()) as CalendarFeed[];
}

export async function createWorkspaceCalendarFeed(input: {
  workspaceId: string;
  kind: WorkspaceFeedKind;
  name: string;
}) {
  const response = await client["calendar-feed"].workspace[
    ":workspaceId"
  ].$post({
    param: { workspaceId: input.workspaceId },
    json: { kind: input.kind, name: input.name },
  });
  await ok(response);
  return (await response.json()) as CreatedCalendarFeed;
}

export async function createProjectCalendarFeed(input: {
  projectId: string;
  name: string;
}) {
  const response = await client["calendar-feed"].project[":projectId"].$post({
    param: { projectId: input.projectId },
    json: { name: input.name },
  });
  await ok(response);
  return (await response.json()) as CreatedCalendarFeed;
}

export async function revokeCalendarFeed(id: string) {
  const response = await client["calendar-feed"][":id"].$delete({
    param: { id },
  });
  await ok(response);
  return response.json();
}
