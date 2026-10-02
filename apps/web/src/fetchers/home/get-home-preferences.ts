import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function getHomePreferences(workspaceId: string) {
  const response = await client.home.preferences.$get({
    query: { workspaceId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export type HomePreferences = Awaited<ReturnType<typeof getHomePreferences>>;

export default getHomePreferences;
