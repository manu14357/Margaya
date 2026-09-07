import { responseTimestamp, z } from "../openapi";

export const commentSchema = z
  .object({
    id: z.string(),
    taskId: z.string(),
    userId: z.string(),
    content: z.string(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
    visibility: z.enum(["internal", "public"]).openapi({
      description: "public comments also show on the public board.",
    }),
    user: z
      .object({
        name: z.string(),
        image: z.string().nullable(),
        isWorkspaceMember: z.boolean(),
        isGuest: z.boolean().openapi({
          description: "A guest (anonymous) account from a public board.",
        }),
      })
      .openapi("CommentAuthor"),
  })
  .openapi("Comment");

export const commentListSchema = z.array(commentSchema);
