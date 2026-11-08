import { z } from "../openapi";

export const invitationParam = z.object({ id: z.string() });

export const updateInvitationRoleBody = z
  .object({
    role: z.string().trim().min(1).max(100).openapi({
      description:
        "The role the invitation grants: viewer, member, admin, guest (only the projects they are added to) or one of the workspace's custom roles.",
      example: "viewer",
    }),
  })
  .openapi("UpdateInvitationRoleBody");

/** At most this many projects per invitation. */
export const MAX_INVITATION_PROJECTS = 50;

export const setInvitationProjectsBody = z
  .object({
    projects: z
      .array(
        z
          .object({
            projectId: z.string().min(1),
            role: z.string().trim().min(1).max(64).openapi({
              description:
                "The project role: viewer, member, admin or one of the workspace's custom roles. For a guest it caps their rights in that project, which never go beyond the Guest role.",
              example: "member",
            }),
          })
          .strict(),
      )
      .max(MAX_INVITATION_PROJECTS)
      .openapi({
        description: `The projects the invitee joins on acceptance, replacing the current list; an empty list clears it. At most ${MAX_INVITATION_PROJECTS}.`,
      }),
  })
  .strict()
  .openapi("SetInvitationProjectsBody");
