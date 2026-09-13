import { z } from "../openapi";

const isoDateTime = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Expected an ISO 8601 date or date-time",
  });

export const auditLogFilterQuery = z.object({
  workspaceId: z.string().min(1).openapi({
    description: "The workspace whose audit log to read.",
  }),
  actorId: z.string().min(1).max(100).optional().openapi({
    description:
      "Only entries by this user, including entries made with their API keys.",
  }),
  actorType: z.enum(["user", "api_key", "system"]).optional().openapi({
    description: "Only entries by this kind of actor.",
  }),
  action: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z_.]+$/)
    .optional()
    .openapi({
      description:
        'An action or action prefix, e.g. "member" or "member." for every membership action, or "member.role_changed".',
    }),
  targetType: z.string().min(1).max(50).optional().openapi({
    description: 'Only entries about this kind of target, e.g. "webhook".',
  }),
  from: isoDateTime.optional().openapi({
    description: "Entries at or after this instant (ISO 8601).",
  }),
  to: isoDateTime.optional().openapi({
    description: "Entries before this instant (ISO 8601).",
  }),
});

export const listAuditLogQuery = auditLogFilterQuery.extend({
  cursor: z.string().max(512).optional().openapi({
    description: "The nextCursor of the previous page.",
  }),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

export type AuditLogFilter = z.infer<typeof auditLogFilterQuery>;
export type ListAuditLogInput = z.infer<typeof listAuditLogQuery>;
