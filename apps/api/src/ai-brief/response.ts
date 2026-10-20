import { z } from "../openapi";
import { BRIEF_SCOPE_TYPES } from "./types";

// Response schemas of the stakeholder brief routes (ai-brief/index.ts).

const taskRef = z
  .object({
    id: z.string(),
    key: z.string(),
    title: z.string(),
    projectId: z.string(),
  })
  .openapi("AiBriefTask");

const taskList = z.object({
  total: z.number().int(),
  tasks: z.array(taskRef).openapi({ description: "At most 25." }),
});

export const briefFactsSchema = z
  .object({
    scope: z.object({
      type: z.enum(BRIEF_SCOPE_TYPES),
      id: z.string(),
      projectId: z.string(),
      name: z.string(),
      startDate: z.string().nullable(),
      endDate: z.string().nullable(),
    }),
    generatedAt: z.string(),
    since: z.string().openapi({
      description:
        "Changes are counted from here: the previous shared brief, else 7 days ago.",
    }),
    truncated: z.boolean(),
    counts: z.object({
      total: z.number().int(),
      backlog: z.number().int(),
      unstarted: z.number().int(),
      started: z.number().int(),
      completed: z.number().int(),
      cancelled: z.number().int(),
    }),
    percent: z.number().int(),
    completed: taskList,
    added: taskList,
    removed: taskList,
    inProgress: taskList,
    risks: z.array(
      z.object({
        kind: z.string(),
        severity: z.enum(["high", "medium", "low"]),
        total: z.number().int(),
        tasks: z.array(taskRef),
      }),
    ),
    forecast: z
      .object({
        status: z.enum(["ok", "complete", "insufficient_history"]),
        remaining: z.number().int(),
        p50: z.string().nullable(),
        p85: z.string().nullable(),
        p95: z.string().nullable(),
        probabilityByEnd: z.number().int().nullable().openapi({
          description: "Percent chance to finish by the end date.",
        }),
      })
      .nullable(),
    previous: z
      .object({
        briefId: z.string(),
        sharedAt: z.string(),
        percent: z.number().int(),
        forecastP85: z.string().nullable(),
        risks: z.record(z.string(), z.number().int()),
      })
      .nullable()
      .openapi({ description: "The last shared brief, for the diff." }),
  })
  .openapi("AiBriefFacts");

export const briefCitationSchema = z
  .object({
    key: z.string(),
    taskId: z.string(),
    title: z.string(),
    url: z.string(),
  })
  .openapi("AiBriefCitation");

export const briefSharedSchema = z
  .object({
    id: z.string(),
    sharedAt: z.string(),
    pageId: z.string().nullable(),
  })
  .openapi("AiBriefShared");
