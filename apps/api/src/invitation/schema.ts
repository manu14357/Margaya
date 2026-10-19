import { z } from "../openapi";

export const invitationParam = z.object({ id: z.string() });

export const updateInvitationRoleBody = z
  .object({
    role: z.string().trim().min(1).max(100).openapi({
      description:
        "The role the invitation grants: viewer, member, admin or one of the workspace's custom roles.",
      example: "viewer",
    }),
  })
  .openapi("UpdateInvitationRoleBody");
