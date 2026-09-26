import { client } from "@margaya/libs";
import type { CreatableColumnGroup } from "@/lib/column-groups";
import { HttpError } from "@/lib/http-error";

export type UpdateColumnData = {
  name?: string;
  icon?: string | null;
  color?: string | null;
  group?: CreatableColumnGroup;
  isFinal?: boolean;
};

async function updateColumn(id: string, data: UpdateColumnData) {
  const response = await client.column[":id"].$put({
    param: { id },
    json: data,
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default updateColumn;
