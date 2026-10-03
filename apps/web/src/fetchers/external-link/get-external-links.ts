import { client } from "@margaya/libs";

import { HttpError } from "@/lib/http-error";

async function getExternalLinks(taskId: string) {
  const response = await client["external-link"].task[":taskId"].$get({
    param: { taskId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  const data = await response.json();

  return data;
}

export default getExternalLinks;
