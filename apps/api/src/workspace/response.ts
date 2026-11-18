import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";

export const workspaceMemberSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    image: z.string().nullable(),
    role: z.string().openapi({
      description:
        "The member's workspace role: a built-in role (owner, admin, member, guest) or a custom role name.",
    }),
    kind: z.enum(["human", "agent"]).openapi({
      description:
        "agent for AI agents: assignable and mentionable, never a seat, can't sign in.",
    }),
  })
  .openapi("WorkspaceMember");

export const workspaceMemberListSchema = z.array(workspaceMemberSchema);

export const workspaceMemberProfileSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    image: z.string().nullable(),
    role: z.string().openapi({
      description:
        "The member's workspace role: a built-in role (owner, admin, member, guest) or a custom role name.",
    }),
    joinedAt: responseTimestamp.openapi({
      description: "When they joined the workspace.",
    }),
    kind: z.enum(["human", "agent"]).openapi({
      description:
        "agent for AI agents: assignable and mentionable, never a seat, can't sign in.",
    }),
  })
  .openapi("WorkspaceMemberProfile");

export const workspaceSettingsSchema = z
  .object({
    timezone: z.string().openapi({
      description:
        "The workspace's IANA time zone. Existing workspaces start on UTC.",
      example: "UTC",
    }),
    allowPublicPages: z.boolean().openapi({
      description:
        "Whether pages may be published to a read-only public link. Off by default; turning it off revokes every published page link.",
    }),
    allowA2a: z.boolean().openapi({
      description:
        "Whether external agents may hand work to the workspace over A2A. Off by default.",
    }),
  })
  .openapi("WorkspaceSettings");

export const workspaceDeletionSchema = z
  .object({
    pending: z.boolean().openapi({
      description:
        "A deletion is scheduled: the workspace is read-only until it is deleted or the deletion is cancelled.",
    }),
    scheduledAt: nullableResponseTimestamp,
    dueAt: nullableResponseTimestamp.openapi({
      description:
        "When the workspace will be deleted (the purge runs hourly after this).",
    }),
    scheduledBy: z
      .object({ id: z.string(), name: z.string() })
      .nullable()
      .openapi({ description: "Who scheduled the deletion, while pending." }),
    graceDays: z.number().int().openapi({
      description:
        "The server's grace period in days (WORKSPACE_DELETION_GRACE_DAYS).",
    }),
  })
  .openapi("WorkspaceDeletion");

export const workspacePermissionsSchema = z
  .object({
    workspaceId: z.string(),
    userId: z.string(),
    role: z.string().openapi({
      description:
        "Your workspace role: a built-in role (owner, admin, member, viewer, guest) or a custom role name.",
    }),
    joinedAt: responseTimestamp.openapi({
      description: "When you joined the workspace.",
    }),
    permissions: z.record(z.string(), z.array(z.string())).openapi({
      description:
        "What you may do across the workspace: each resource of the permission vocabulary with the actions granted to you, resolved by the same rules the API enforces (stored or custom role first, built-in role otherwise). A resource with no granted action is left out. In a restricted project, or as a guest, your project role there can cap these further (getMyProjectRights).",
      example: {
        project: ["create", "read"],
        task: ["create", "read", "update"],
      },
    }),
  })
  .openapi("WorkspacePermissions");
