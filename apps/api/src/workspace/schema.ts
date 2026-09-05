import { z } from "../openapi";

export const workspaceIdParam = z.object({ workspaceId: z.string() });

export const workspaceMemberParam = z.object({
  workspaceId: z.string(),
  userId: z.string(),
});

export const updateWorkspaceSettingsBody = z.object({
  timezone: z.string().min(1).max(64).openapi({
    description:
      'IANA time zone name such as "Europe/Berlin" or "UTC". It defines "today" and day boundaries for server-side date logic: cycle status, automations and analytics defaults. Raw offsets are rejected.',
    example: "Europe/Berlin",
  }),
});
