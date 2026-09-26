import { client } from "@margaya/libs";
import type { CreatableColumnGroup } from "@/lib/column-groups";
import { HttpError } from "@/lib/http-error";

export type CreateColumnData = {
  name: string;
  icon?: string;
  color?: string;
  group?: CreatableColumnGroup;
  isFinal?: boolean;
};

async function createColumn(projectId: string, data: CreateColumnData) {
  const response = await client.column[":projectId"].$post({
    param: { projectId },
    json: data,
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default createColumn;
