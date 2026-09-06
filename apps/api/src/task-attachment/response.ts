import { responseTimestamp, z } from "../openapi";

export const taskAttachmentSchema = z
  .object({
    id: z.string().openapi({ description: "The asset id." }),
    taskId: z.string(),
    filename: z.string(),
    mimeType: z.string().openapi({
      description: "The content type storage reported for the uploaded file.",
    }),
    size: z.number().openapi({ description: "Bytes, as verified in storage." }),
    kind: z.enum(["image", "attachment"]).openapi({
      description:
        "image for the image types shown inline, attachment otherwise.",
    }),
    url: z.string().openapi({
      description:
        "GET /asset/{id}: images open inline, every other type downloads. Never readable without signing in, even on a public project.",
    }),
    downloadUrl: z.string().openapi({
      description: "The same URL with ?download=1, which always downloads.",
    }),
    createdBy: z
      .object({
        id: z.string(),
        name: z.string(),
        image: z.string().nullable(),
      })
      .nullable()
      .openapi({
        description: "Who uploaded it; null when the user was deleted.",
      }),
    createdAt: responseTimestamp,
  })
  .openapi("TaskAttachment");

export const taskAttachmentListSchema = z.array(taskAttachmentSchema);

export const taskAttachmentDeleteResultSchema = z
  .object({ id: z.string() })
  .openapi("TaskAttachmentDeleteResult");
