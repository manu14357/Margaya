import { z } from "../openapi";

const settingValue = z
  .union([z.string(), z.number(), z.boolean(), z.null()])
  .openapi({
    description:
      "The new value, validated by the setting's catalog rule. null clears the saved value; secrets take a non-empty string.",
  });

export const updateInstanceSettingsBody = z
  .object({
    values: z
      .record(z.string().max(100), settingValue)
      .refine((values) => {
        const size = Object.keys(values).length;
        return size >= 1 && size <= 40;
      }, "Send 1 to 40 settings")
      .openapi({
        description:
          "Setting keys from the catalog (for example auth.inviteOnly) mapped to new values.",
      }),
  })
  .strict();

const cursor = z.string().max(512).optional();

export const listInstancePublicBoardsQuery = z.object({
  search: z.string().trim().max(100).optional(),
  cursor,
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const listInstanceWorkspacesQuery = listInstancePublicBoardsQuery.extend(
  {
    pendingDeletion: z.enum(["true", "false"]).optional().openapi({
      description:
        "true lists only workspaces scheduled for deletion (read-only until they are purged or the deletion is cancelled).",
    }),
  },
);

export const sendInstanceTestEmailBody = z
  .object({
    to: z.string().trim().max(320).optional().openapi({
      description: "Recipient; defaults to the caller's email.",
    }),
  })
  .strict();

export const addInstanceAdminBody = z
  .object({ email: z.string().trim().min(1).max(320) })
  .strict();

export const instanceAdminParam = z.object({
  userId: z.string().min(1).max(128),
});

export const confirmInstanceAdminBody = z
  .object({
    password: z.string().min(1).max(256).openapi({
      description: "The caller's current password.",
    }),
  })
  .strict();

export const listInstanceAuditQuery = z.object({
  cursor,
  limit: z.coerce.number().int().min(1).max(100).default(50),
  action: z.string().trim().max(500).optional().openapi({
    description:
      "Comma-separated action names to keep, for example user.banned.",
  }),
});

export const listInstanceUsersQuery = z.object({
  search: z.string().trim().max(100).optional().openapi({
    description: "Matches the name or email.",
  }),
  status: z.enum(["all", "admins", "banned"]).default("all"),
  cursor,
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const instanceUserParam = z.object({
  userId: z.string().min(1).max(128),
});

export const banInstanceUserBody = z
  .object({
    reason: z.string().trim().max(500).optional(),
    expiresInDays: z
      .number()
      .int()
      .min(1)
      .max(3650)
      .nullable()
      .optional()
      .openapi({
        description:
          "Days until the ban lifts; omitted or null bans until unbanned.",
      }),
  })
  .strict();

export const resetInstanceUserPasswordBody = z
  .object({
    password: z.string().min(1).max(256).optional().openapi({
      description:
        "A new password to set now (the account is signed out everywhere). Omit it to email a reset link instead.",
    }),
  })
  .strict();
