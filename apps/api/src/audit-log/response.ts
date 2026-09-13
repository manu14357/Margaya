import { responseTimestamp, z } from "../openapi";

export const auditLogEntrySchema = z
  .object({
    id: z.string(),
    action: z.string().openapi({
      description: 'A stable dotted action name, e.g. "member.role_changed".',
    }),
    actor: z
      .object({
        type: z.enum(["user", "api_key", "system"]),
        userId: z.string().nullable().openapi({
          description: "The user, or the owner of the API key.",
        }),
        apiKeyId: z.string().nullable(),
        name: z.string().nullable().openapi({
          description:
            "The user's or key's name when the entry was written (a snapshot).",
        }),
        image: z.string().nullable().openapi({
          description: "The user's current avatar, when they still exist.",
        }),
      })
      .openapi("AuditLogActor"),
    target: z
      .object({
        type: z.string(),
        id: z.string().nullable(),
        label: z.string().nullable().openapi({
          description: "The target's name when the entry was written.",
        }),
      })
      .nullable()
      .openapi("AuditLogTarget"),
    metadata: z.record(z.string(), z.unknown()).nullable().openapi({
      description:
        "Details such as a { field: { before, after } } diff. Secrets are never recorded.",
    }),
    ipAddress: z.string().nullable(),
    userAgent: z.string().nullable(),
    createdAt: responseTimestamp,
  })
  .openapi("AuditLogEntry");

export const auditLogPageSchema = z
  .object({
    items: z.array(auditLogEntrySchema),
    nextCursor: z.string().nullable().openapi({
      description: "Pass as cursor for the next (older) page; null at the end.",
    }),
    retentionDays: z.number().int().openapi({
      description:
        "Days entries are kept (AUDIT_LOG_RETENTION_DAYS); 0 keeps them forever.",
    }),
  })
  .openapi("AuditLogPage");
