import { responseTimestamp, z } from "../openapi";

const versionShape = {
  id: z.string(),
  taskId: z.string(),
  authorId: z.string().nullable().openapi({
    description:
      "Who saved it. Null for the text the task had before its history began, and for deleted users.",
  }),
  author: z
    .object({
      id: z.string(),
      name: z.string(),
      image: z.string().nullable(),
    })
    .nullable(),
  savedAt: responseTimestamp.openapi({
    description:
      "The latest save in this version: saves by the same person within 10 minutes share one version.",
  }),
  createdAt: responseTimestamp,
  size: z.number().int().openapi({
    description: "Length of the description in characters.",
  }),
};

export const taskDescriptionVersionSchema = z
  .object({
    ...versionShape,
    preview: z.string().openapi({
      description: "The start of the description as plain text.",
    }),
  })
  .openapi("TaskDescriptionVersion");

export const taskDescriptionVersionListSchema = z.array(
  taskDescriptionVersionSchema,
);

export const taskDescriptionVersionDetailSchema = z
  .object({
    ...versionShape,
    content: z.string().openapi({ description: "The description markdown." }),
  })
  .openapi("TaskDescriptionVersionDetail");
