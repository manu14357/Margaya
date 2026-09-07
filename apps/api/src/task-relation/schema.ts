import { z } from "../openapi";
import { RELATION_INPUT_NAMES } from "./types";

export const taskIdParam = z.object({ taskId: z.string() });

export const taskRelationParam = z.object({ id: z.string() });

export const createTaskRelationBody = z.object({
  sourceTaskId: z.string().max(64),
  targetTaskId: z.string().max(64),
  relationType: z.enum(RELATION_INPUT_NAMES).openapi({
    description:
      "subtask: sourceTaskId is the parent of targetTaskId. blocks (or blocking): source blocks target; blocked_by: source is blocked by target. related and duplicate (source is a duplicate of target) read the same from both tasks. start_before / start_after and finish_before / finish_after order the two tasks' starts or finishes. Inverse names (blocked_by, start_after, finish_after) are stored flipped as blocks, start_before and finish_before, so the response may swap the two ids.",
  }),
});

export const setTaskParentBody = z.object({
  parentTaskId: z.string().max(64).nullable().openapi({
    description:
      "The new parent, a task of the same project; null removes the parent.",
  }),
});

export const projectIdParam = z.object({ projectId: z.string() });
