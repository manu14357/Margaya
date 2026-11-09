import { responseTimestamp, z } from "../openapi";

export const pendingInvitationSchema = z
  .object({
    id: z.string(),
    email: z.string(),
    workspaceId: z.string(),
    workspaceName: z.string(),
    inviterName: z.string(),
    expiresAt: responseTimestamp,
    createdAt: responseTimestamp,
    status: z.string().openapi({
      description:
        "Always `pending` here; expired and accepted ones are filtered out.",
    }),
  })
  .openapi("PendingInvitation");

export const pendingInvitationListSchema = z.array(pendingInvitationSchema);

export const invitationDetailsSchema = z
  .object({
    valid: z.boolean().openapi({
      description: "True only when the invitation can still be accepted.",
    }),
    invitation: z
      .object({
        id: z.string(),
        email: z.string(),
        workspaceName: z.string(),
        inviterName: z.string(),
        expiresAt: responseTimestamp,
        status: z.string(),
        expired: z.boolean(),
      })
      .optional()
      .openapi({
        description:
          "Omitted when the invitation does not exist, was already accepted, or was canceled -- the details are withheld rather than leaked.",
      }),
    error: z.string().optional().openapi({
      description: "Why the invitation is unusable, when valid is false.",
    }),
  })
  .openapi("InvitationDetails");

export const workspaceInvitationSchema = z
  .object({
    id: z.string(),
    email: z.string(),
    role: z.string().nullable(),
    workspaceId: z.string(),
    teamId: z.string().nullable().optional().openapi({
      deprecated: true,
      description:
        "Deprecated: invitations no longer target a team, and new ones leave it null. Kept so older clients still parse the response; don't rely on it.",
    }),
    status: z.string(),
    inviterId: z.string(),
    expiresAt: responseTimestamp,
    createdAt: responseTimestamp,
  })
  .openapi("WorkspaceInvitation");

export const invitationProjectsSchema = z
  .object({
    projects: z.array(
      z.object({
        projectId: z.string(),
        role: z.string().openapi({ description: "The project role." }),
      }),
    ),
  })
  .openapi("InvitationProjects");
