import { client } from "@margaya/libs";

import { HttpError } from "@/lib/http-error";

async function getColumns(projectId: string) {
  const response = await client.column[":projectId"].$get({
    param: { projectId },
    query: {},
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getColumns;
