import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function getQuickLinks(workspaceId: string) {
  const response = await client["quick-link"].$get({ query: { workspaceId } });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export type QuickLink = Awaited<ReturnType<typeof getQuickLinks>>[number];

export default getQuickLinks;
