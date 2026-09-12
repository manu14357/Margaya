import { z } from "../openapi";
import { taskSchema } from "../task/response";
import { COPY_OPTION_KEYS } from "./copy-plan";

export const taskCopyResultSchema = z
  .object({
    task: taskSchema,
    key: z.string().openapi({
      description: "The copy's task key, e.g. WEB-13.",
    }),
    skipped: z.array(z.enum(COPY_OPTION_KEYS)).openapi({
      description:
        "Requested options the source had data for that could not be copied, e.g. parent or planning across projects, planning while the feature is off, or assignees when all of them left the workspace.",
    }),
  })
  .openapi("TaskCopyResult");
