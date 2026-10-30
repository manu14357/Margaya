import { z } from "../openapi";

export const taskIdParam = z.object({ taskId: z.string() });

export const commentParam = z.object({ id: z.string() });

export const createCommentBody = z.object({
  content: z.string().min(1),
  // Both or neither: a name without a source would render as an unattributed
  // impersonation of a real account.
  externalUserName: z.string().max(120).optional().openapi({
    description:
      "Attribution for an imported comment. Requires workspace:manage_settings and externalSource; otherwise ignored.",
  }),
  externalSource: z
    .enum(["trello", "jira", "linear", "asana"])
    .optional()
    .openapi({
      description:
        "The tool the comment was imported from. Supplying external attribution requires workspace:manage_settings.",
    }),
  visibility: z.enum(["internal", "public"]).optional().openapi({
    description:
      "internal (default) or public: also shown on the project's public board. Public needs a published board with comments on (409 otherwise). A reply can only be public when the comment it answers is public (400 otherwise).",
  }),
  parentId: z.string().min(1).max(128).optional().openapi({
    description:
      "Reply in a thread: the id of a comment on the same task. A reply to a reply joins the top-level comment's thread (threads are one level deep). 404 when the comment is not on this task.",
  }),
});

export const updateCommentBody = z.object({ content: z.string().min(1) });
