import { z } from "../openapi";

export const workspaceIdParam = z.object({ workspaceId: z.string() });

export const projectIdParam = z.object({ projectId: z.string() });

export const feedIdParam = z.object({ id: z.string() });

export const feedTokenParam = z.object({
  token: z.string().openapi({
    description: "The feed's secret token, from its subscription URL",
  }),
});

const feedName = z.string().trim().min(1).max(120).openapi({
  description:
    "The calendar's display name in calendar apps, in the creator's language",
});

export const createWorkspaceFeedBody = z.object({
  kind: z.enum(["my_tasks", "planning"]).openapi({
    description:
      "my_tasks: dated tasks assigned to you. planning: milestones and cycles of every project you can see.",
  }),
  name: feedName,
});

export const createProjectFeedBody = z.object({ name: feedName });
