import { z } from "../openapi";
import { API_KEY_ACCESS, API_KEY_AREAS, MAX_SCOPED_PROJECTS } from "./scope";

const areaLevel = z.enum(["read", "write"]);

export const createScopedApiKeyBody = z
  .object({
    name: z.string().trim().min(1).max(32),
    expiresIn: z
      .number()
      .int()
      .positive()
      .nullable()
      .openapi({ description: "Seconds until the key expires; null never." }),
    access: z.enum(API_KEY_ACCESS).default("full").openapi({
      description:
        "full: everything its owner can do. read: reads only, and no other method. custom: the chosen areas only.",
    }),
    areas: z
      .partialRecord(z.enum(API_KEY_AREAS), areaLevel)
      .optional()
      .openapi({
        description:
          "For custom access: each permission area at read or write. Areas left out are refused.",
      }),
    projectIds: z
      .array(z.string().min(1).max(128))
      .max(MAX_SCOPED_PROJECTS)
      .optional()
      .openapi({
        description:
          "Limit the key to these projects. Other projects read as missing (404), and workspace-wide routes are refused except the project list.",
      }),
  })
  .strict()
  .refine(
    (body) =>
      body.access !== "custom" || Object.keys(body.areas ?? {}).length > 0,
    { message: "Choose at least one area", path: ["areas"] },
  );

export const apiKeyIdParam = z.object({ id: z.string().min(1).max(128) });

export const listApiKeyRequestsQuery = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
