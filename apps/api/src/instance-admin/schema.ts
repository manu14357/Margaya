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

export const listInstanceWorkspacesQuery = z.object({
  search: z.string().trim().max(100).optional(),
  cursor,
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const listInstancePublicBoardsQuery = listInstanceWorkspacesQuery;

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
