import { responseTimestamp, z } from "../openapi";

const commentAuthorSchema = z
  .object({
    name: z.string(),
    image: z.string().nullable(),
    isWorkspaceMember: z.boolean(),
    isGuest: z.boolean().openapi({
      description: "A guest (anonymous) account from a public board.",
    }),
  })
  .openapi("CommentAuthor");

export const commentSchema = z
  .object({
    id: z.string(),
    taskId: z.string(),
    userId: z.string().nullable().openapi({
      description: "The author, or null when their account was deleted.",
    }),
    content: z.string(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
    visibility: z.enum(["internal", "public"]).openapi({
      description: "public comments also show on the public board.",
    }),
    // A union keeps the null in the OpenAPI document next to the $ref.
    user: z.union([commentAuthorSchema, z.null()]).openapi({
      description:
        "The author, or null when their account (a person or an agent) was deleted; the comment stays.",
    }),
  })
  .openapi("Comment");

export const commentListSchema = z.array(commentSchema);
