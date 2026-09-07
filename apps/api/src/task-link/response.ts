import { responseTimestamp, z } from "../openapi";

export const taskLinkCreatorSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    image: z.string().nullable(),
  })
  .openapi("TaskLinkCreator", {
    description: "Who added the link: user id, display name and avatar URL.",
  });

export const taskLinkSchema = z
  .object({
    id: z.string(),
    taskId: z.string(),
    url: z.string().openapi({ description: "The normalized URL." }),
    title: z.string().nullable(),
    host: z.string().openapi({
      description:
        "The URL's host without a leading www. (punycode for international names), shown so a title can't hide the destination.",
    }),
    createdBy: taskLinkCreatorSchema.nullable().openapi({
      description: "Null when the user was deleted.",
    }),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("TaskLink");

export const taskLinkListSchema = z.array(taskLinkSchema);

export const taskLinkDeleteResultSchema = z
  .object({ id: z.string() })
  .openapi("TaskLinkDeleteResult");
