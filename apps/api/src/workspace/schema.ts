import { z } from "../openapi";

export const workspaceIdParam = z.object({ workspaceId: z.string() });

export const workspaceMemberParam = z.object({
  workspaceId: z.string(),
  userId: z.string(),
});

export const updateWorkspaceSettingsBody = z
  .object({
    timezone: z.string().min(1).max(64).optional().openapi({
      description:
        'IANA time zone name such as "Europe/Berlin" or "UTC". It defines "today" and day boundaries for server-side date logic: cycle status, automations and analytics defaults. Raw offsets are rejected.',
      example: "Europe/Berlin",
    }),
    allowPublicPages: z.boolean().optional().openapi({
      description:
        "Allow pages to be published to a read-only public link. Turning it off revokes every published page link of the workspace.",
    }),
    allowA2a: z.boolean().optional().openapi({
      description:
        "Let external agents hand work to the workspace over the A2A protocol, with a member's API key or OAuth token and that member's permissions. Off by default.",
    }),
  })
  .refine(
    (body) =>
      body.timezone !== undefined ||
      body.allowPublicPages !== undefined ||
      body.allowA2a !== undefined,
    "Provide at least one setting to change",
  );
