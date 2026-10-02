import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function getStickies({
  workspaceId,
  q,
  limit,
  cursor,
}: {
  workspaceId: string;
  q?: string;
  limit?: number;
  cursor?: string | null;
}) {
  const response = await client.sticky.$get({
    query: {
      workspaceId,
      ...(q ? { q } : {}),
      ...(limit ? { limit: String(limit) } : {}),
      ...(cursor ? { cursor } : {}),
    },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export type StickyPage = Awaited<ReturnType<typeof getStickies>>;
export type Sticky = StickyPage["items"][number];

export default getStickies;
