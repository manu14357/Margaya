import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";
import { API_KEY_ACCESS, API_KEY_AREAS } from "./scope";

export const apiKeyScopeSchema = z
  .object({
    access: z.enum(API_KEY_ACCESS),
    areas: z.partialRecord(z.enum(API_KEY_AREAS), z.enum(["read", "write"])),
    projects: z
      .array(z.object({ id: z.string(), name: z.string().nullable() }))
      .nullable()
      .openapi({
        description:
          "The projects the key is limited to, or null for every project. A deleted project keeps its id with a null name.",
      }),
  })
  .openapi("ApiKeyScope");

export const apiKeySummarySchema = z
  .object({
    id: z.string(),
    name: z.string().nullable(),
    start: z.string().nullable(),
    enabled: z.boolean(),
    createdAt: responseTimestamp,
    expiresAt: nullableResponseTimestamp,
    lastRequest: nullableResponseTimestamp,
    scope: apiKeyScopeSchema,
  })
  .openapi("ApiKeySummary");

export const createdApiKeySchema = apiKeySummarySchema
  .extend({
    key: z.string().openapi({
      description: "The key itself. Shown once; only a hash is stored.",
    }),
  })
  .openapi("CreatedApiKey");

export const apiKeyRequestPageSchema = z
  .object({
    items: z.array(
      z.object({
        id: z.string(),
        method: z.string(),
        route: z.string().openapi({
          description:
            "The route template, such as /api/task/:id; never the concrete path or query string.",
        }),
        status: z.number().int(),
        durationMs: z.number().int(),
        createdAt: responseTimestamp,
      }),
    ),
    nextCursor: z.string().nullable(),
  })
  .openapi("ApiKeyRequestPage");
