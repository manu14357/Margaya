import { client } from "@margaya/libs";

import { HttpError } from "@/lib/http-error";
import type { RelationInputName } from "@/lib/task-relations";

async function createTaskRelation({
  sourceTaskId,
  targetTaskId,
  relationType,
}: {
  sourceTaskId: string;
  targetTaskId: string;
  /** Inverse names (blocked_by, start_after, finish_after) are stored flipped. */
  relationType: RelationInputName;
}) {
  const response = await client["task-relation"].$post({
    json: {
      sourceTaskId,
      targetTaskId,
      relationType,
    },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  const data = await response.json();

  return data;
}

export default createTaskRelation;
