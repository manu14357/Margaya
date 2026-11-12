import { aiProvenanceField } from "../ai/provenance";
import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";
import { reactionGroupSchema } from "../reaction/response";
import { PROJECT_UPDATE_HEALTHS } from "./types";

const health = z.enum(PROJECT_UPDATE_HEALTHS);

const personSchema = z
  .object({ id: z.string(), name: z.string(), image: z.string().nullable() })
  .openapi("ProjectUpdatePerson");

const taskRefSchema = z.object({
  id: z.string(),
  key: z.string().openapi({ example: "WEB-12" }),
  title: z.string(),
});

const taskListSchema = z.object({
  total: z.number().int(),
  tasks: z.array(taskRefSchema).openapi({
    description: "The first tasks (up to 10); `total` counts all.",
  }),
});

export const projectUpdateFactsSchema = z
  .object({
    generatedAt: z.string(),
    since: z.string().openapi({
      description:
        "Changes are counted from the previous update, or 7 days back.",
    }),
    sinceLastUpdate: z.boolean(),
    counts: z.object({
      total: z.number().int(),
      open: z.number().int(),
      completed: z.number().int(),
      percent: z.number().int(),
    }),
    completed: taskListSchema,
    moved: z.object({ total: z.number().int() }),
    added: z.object({ total: z.number().int() }),
    overdue: taskListSchema,
    blocked: taskListSchema,
    inProgress: taskListSchema,
    cycles: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        endDate: z.string(),
        total: z.number().int(),
        completed: z.number().int(),
        percent: z.number().int(),
      }),
    ),
    risks: z.array(
      z.object({
        kind: z.string(),
        severity: z.enum(["high", "medium", "low"]),
        total: z.number().int(),
      }),
    ),
    forecastP85: z.string().nullable(),
    suggestedHealth: health,
    truncated: z.boolean(),
  })
  .openapi("ProjectUpdateFacts", {
    description:
      "Numbers computed by the server from live project data. A model never writes them.",
  });

export const projectUpdateSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    workspaceId: z.string(),
    author: personSchema.nullable().openapi({
      description: "Null when the author's account was deleted.",
    }),
    health,
    summary: z.string(),
    highlights: z.string().nullable(),
    blockers: z.string().nullable(),
    nextSteps: z.string().nullable(),
    aiProvenance: aiProvenanceField,
    facts: projectUpdateFactsSchema.nullable(),
    commentCount: z.number().int(),
    reactions: z.array(reactionGroupSchema),
    canEdit: z.boolean().openapi({
      description:
        "The caller may edit or delete it: its author, or someone with project:update.",
    }),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
    editedAt: nullableResponseTimestamp.openapi({
      description: "Set when the update was edited after posting.",
    }),
  })
  .openapi("ProjectUpdate");

export const projectUpdateCommentSchema = z
  .object({
    id: z.string(),
    updateId: z.string(),
    author: personSchema.nullable(),
    content: z.string(),
    canDelete: z.boolean(),
    createdAt: responseTimestamp,
  })
  .openapi("ProjectUpdateComment");

export const projectUpdateListSchema = z
  .object({
    updates: z.array(projectUpdateSchema),
    nextCursor: z.string().nullable(),
  })
  .openapi("ProjectUpdateList");

export const projectUpdateDetailSchema = projectUpdateSchema
  .extend({ comments: z.array(projectUpdateCommentSchema) })
  .openapi("ProjectUpdateDetail");

export const projectUpdateDraftSchema = z
  .object({
    facts: projectUpdateFactsSchema,
    draft: z.object({
      health,
      summary: z.string(),
      highlights: z.string().nullable(),
      blockers: z.string().nullable(),
      nextSteps: z.string().nullable(),
    }),
    aiDrafted: z.boolean().openapi({
      description:
        'True when a model wrote the text; false for the template. Post an AI draft with `aiAssist: { feature: "project_update" }` so the update is labelled AI-generated.',
    }),
    aiUnavailable: z.string().nullable().openapi({
      description:
        "Why AI was asked for but the template was used: an AI error code such as AI_DISABLED, or AI_FORBIDDEN without ai:use.",
    }),
  })
  .openapi("ProjectUpdateDraft");

export const projectUpdateFollowSchema = z
  .object({
    following: z.boolean(),
    isLead: z.boolean().openapi({
      description: "The project lead follows unless they unfollowed.",
    }),
  })
  .openapi("ProjectUpdateFollow");

export const projectUpdateReminderSchema = z
  .object({
    enabled: z.boolean(),
    weekday: z.number().int(),
    leadUserId: z.string().nullable().openapi({
      description: "Who is reminded; no reminder goes out without a lead.",
    }),
  })
  .openapi("ProjectUpdateReminder");

export const latestProjectUpdatesSchema = z
  .object({
    updates: z.array(
      z.object({
        id: z.string(),
        projectId: z.string(),
        projectName: z.string(),
        health,
        summary: z.string(),
        aiProvenance: aiProvenanceField,
        author: personSchema.nullable(),
        createdAt: responseTimestamp,
      }),
    ),
  })
  .openapi("LatestProjectUpdates");

export const reactionsSchema = z.array(reactionGroupSchema);
