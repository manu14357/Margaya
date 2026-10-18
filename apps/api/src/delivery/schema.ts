import { z } from "../openapi";

export const cycleIdParam = z.object({
  cycleId: z.string().min(1).openapi({ description: "The cycle id." }),
});

export const moduleIdParam = z.object({
  moduleId: z.string().min(1).openapi({ description: "The module id." }),
});

export const projectIdParam = z.object({
  projectId: z.string().min(1).openapi({ description: "The project id." }),
});

export const homeRisksQuery = z.object({
  workspaceId: z.string().min(1).openapi({ description: "The workspace id." }),
});
