import { responseTimestamp, z } from "../openapi";

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
  })
  .openapi("WorkspaceMemberProfile");

export const workspaceSettingsSchema = z
  .object({
    timezone: z.string().openapi({
      description:
        "The workspace's IANA time zone. Existing workspaces start on UTC.",
      example: "UTC",
    }),
  })
  .openapi("WorkspaceSettings");
