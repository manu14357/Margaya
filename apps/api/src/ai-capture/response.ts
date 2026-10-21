import { z } from "../openapi";
import { VALID_PRIORITIES } from "../task/validate-task-fields";
import { CAPTURE_SOURCES } from "./schema";

// Response schemas of the capture route (ai-capture/index.ts).

const reason = z.string().nullable().openapi({
  description: "One line on why, in the caller's language.",
});

export const captureProposalSchema = z
  .object({
    kind: z.enum(["bug", "action"]).openapi({
      description:
        "bug: a problem report (steps, expected, actual); action: an action item from a meeting.",
    }),
    title: z.string(),
    summary: z.string().openapi({
      description: "A short plain-text description.",
    }),
    steps: z.array(z.string()).openapi({
      description: "Steps to reproduce, in order (bugs only; else empty).",
    }),
    expected: z.string().nullable(),
    actual: z.string().nullable(),
    environment: z.string().nullable().openapi({
      description: "Browser, device, version or page, when visible.",
    }),
    priority: z.enum(VALID_PRIORITIES).openapi({
      description:
        "Suggested severity on the task priority scale; no-priority when unclear.",
    }),
    priorityReason: reason,
    labels: z
      .array(
        z.object({ labelId: z.string(), name: z.string(), color: z.string() }),
      )
      .openapi({
        description:
          "Existing workspace labels that fit (attach with PUT /label/{id}/task).",
      }),
    owner: z
      .object({
        userId: z.string(),
        name: z.string(),
        image: z.string().nullable(),
        reason,
      })
      .nullable()
      .openapi({
        description:
          "For action items: a project member the transcript names as the owner. Null otherwise.",
      }),
  })
  .openapi("AiCaptureProposal");

export const captureResultSchema = z
  .object({
    projectId: z.string(),
    source: z.enum(CAPTURE_SOURCES),
    items: z.array(captureProposalSchema).openapi({
      description:
        "Proposed intake requests: one for screenshots and recordings, up to 10 for a transcript. Nothing is created; submit each one with POST /intake/project/{projectId}.",
    }),
  })
  .openapi("AiCaptureResult");
