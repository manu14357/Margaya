import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { loadTaskContext, renderContext, resolveAiScope } from "../ai/context";
import { aiCompleteJson } from "../ai/gateway";
import { buildSystemPrompt, wrapUntrusted } from "../ai/prompt";
import { userLocale } from "../ai-translate/locale";
import { recordAudit } from "../audit-log/record";
import db from "../database";
import { projectTable } from "../database/schema";
import assignLabelToTask from "../label/controllers/assign-label-to-task";
import { VALID_PRIORITIES } from "../task/validate-task-fields";
import { workspacePermissionChecker } from "../utils/require-workspace-permission";
import {
  type CandidateLabel,
  type CandidatePerson,
  type CandidateProject,
  loadTriageCandidates,
  loadTriageTask,
  type SimilarTask,
  similarContextItems,
  type TriageCandidates,
  type TriageTask,
} from "./candidates";

// Triage Copilot (B7): suggested labels, assignee, priority, a better
// project and possible duplicates, each with a one-line reason. The model
// only picks among real candidates by reference; anything else it returns
// is dropped. It has no tools and nothing is written, except labels on
// projects that opted in to auto-apply (audited).

export const TRIAGE_INSTRUCTIONS = `You help triage one item in a project tracker: a new task or an incoming request.
You get the item, candidate labels, candidate assignees, candidate projects, the priority scale and existing tasks that may be similar.
Rules:
- Suggest only from the candidates, using their references exactly (L1, P2, R3, or a task key like WEB-12).
- Suggest a field only when the item or the similar tasks give a clear reason; otherwise return an empty list for it.
- At most 3 labels, 1 assignee, 1 priority, 1 project and 3 possible duplicates. Never repeat what the item already has.
- A possible duplicate must describe the same problem or request, not merely the same area.
- Candidate assignees are people. Suggest one only when that same reference is listed as an assignee of at least one similar task, and name those tasks by key in the reason, such as "Handled similar tasks WEB-3 and WEB-9". Otherwise return an empty assignee list. Never pick someone from personal traits.
- Suggest another project only when the item clearly belongs there.
- Every suggestion has a reason: one plain sentence of at most 20 words that a teammate can check, such as "Similar tasks WEB-3 and WEB-9 carry this label".
- A reason may state only facts present in the data you were given: the item, its comments, the candidates and the similar tasks. Never invent history, roles or activity (who reported, reviewed or worked on something) that the data doesn't show. If no such fact supports a suggestion, leave that field empty.`;

const refList = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["ref", "reason"],
    properties: { ref: { type: "string" }, reason: { type: "string" } },
  },
} as const;

export const TRIAGE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["labels", "assignee", "priority", "project", "duplicates"],
  properties: {
    labels: refList,
    assignee: refList,
    priority: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["value", "reason"],
        properties: {
          value: { type: "string", enum: [...VALID_PRIORITIES] },
          reason: { type: "string" },
        },
      },
    },
    project: refList,
    duplicates: refList,
  },
} as const;

type Ref = { ref: string; reason: string };
type ModelOutput = {
  labels: Ref[];
  assignee: Ref[];
  priority: { value: string; reason: string }[];
  project: Ref[];
  duplicates: Ref[];
};

const MAX_LABELS = 3;
const MAX_DUPLICATES = 3;
/** searchWorkspace: 3 or more means the whole title matched. */
const TITLE_MATCH_SCORE = 3;

function cleanReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 240) : null;
}

function refs(value: unknown): Ref[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const { ref, reason } = entry as Record<string, unknown>;
    if (typeof ref !== "string") return [];
    return [{ ref: ref.trim(), reason: cleanReason(reason) ?? "" }];
  });
}

/** Lenient: a malformed field reads as "no suggestion". */
export function parseTriageOutput(value: unknown): ModelOutput {
  const raw = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  const priority = Array.isArray(raw.priority)
    ? raw.priority.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const { value: level, reason } = entry as Record<string, unknown>;
        return typeof level === "string"
          ? [{ value: level, reason: cleanReason(reason) ?? "" }]
          : [];
      })
    : [];
  return {
    labels: refs(raw.labels),
    assignee: refs(raw.assignee),
    priority,
    project: refs(raw.project),
    duplicates: refs(raw.duplicates),
  };
}

export type RefTables = {
  labels: Map<string, CandidateLabel>;
  people: Map<string, CandidatePerson>;
  projects: Map<string, CandidateProject>;
  tasks: Map<string, SimilarTask>;
};

export function refTables(candidates: TriageCandidates): RefTables {
  return {
    labels: new Map(candidates.labels.map((label, i) => [`L${i + 1}`, label])),
    people: new Map(
      candidates.people.map((person, i) => [`P${i + 1}`, person]),
    ),
    projects: new Map(
      candidates.projects.map((project, i) => [`R${i + 1}`, project]),
    ),
    tasks: new Map(
      candidates.similar.map((task) => [task.key.toUpperCase(), task]),
    ),
  };
}

function refOf<T extends { id: string }>(
  table: Map<string, T>,
  id: string,
): string | null {
  for (const [ref, value] of table) if (value.id === id) return ref;
  return null;
}

/** The prompt's data part; every workspace-authored string is untrusted. */
export function triagePrompt(input: {
  task: TriageTask;
  taskContext: string;
  candidates: TriageCandidates;
  tables: RefTables;
}): string {
  const { task, taskContext, candidates, tables } = input;
  const lines = (entries: string[]) => entries.join("\n") || "(none)";
  const personRef = (id: string) => refOf(tables.people, id) ?? "someone";
  const currentProject = refOf(tables.projects, task.projectId) ?? "unknown";
  const current = [
    `Kind: ${task.isIntake ? "incoming request (intake)" : "task"}`,
    `Current priority: ${task.priority}`,
    `Current assignees: ${task.assigneeIds.map(personRef).join(", ") || "none"}`,
    `Current project: ${currentProject}`,
    `Priority scale: ${VALID_PRIORITIES.join(", ")}`,
  ].join("\n");
  return [
    "The item:",
    taskContext,
    current,
    wrapUntrusted({
      source: "current-labels",
      text: task.labelNames.join(", ") || "(none)",
    }),
    "Candidate labels (reference: name):",
    wrapUntrusted({
      source: "labels",
      text: lines(
        [...tables.labels].map(([ref, label]) => `${ref}: ${label.name}`),
      ),
    }),
    "Candidate assignees (reference: name):",
    wrapUntrusted({
      source: "people",
      text: lines(
        [...tables.people].map(([ref, person]) => `${ref}: ${person.name}`),
      ),
    }),
    "Candidate projects (reference: name):",
    wrapUntrusted({
      source: "projects",
      text: lines(
        [...tables.projects].map(([ref, project]) => `${ref}: ${project.name}`),
      ),
    }),
    "Existing tasks that may be similar (key: title | labels | assignees | status):",
    wrapUntrusted({
      source: "similar-tasks",
      text: lines(
        candidates.similar.map(
          (item) =>
            `${item.key}: ${item.title} | labels: ${item.labelNames.join(", ") || "none"} | assignees: ${item.assigneeIds.map(personRef).join(", ") || "none"} | status: ${item.status ?? "unknown"}`,
        ),
      ),
      maxChars: 12_000,
    }),
    "Return the suggestions as JSON.",
  ].join("\n\n");
}

const TASK_KEY = /(?<![A-Za-z0-9])([A-Z][A-Z0-9]*)-(\d+)(?![0-9])/g;

/**
 * The reason, or null when it cites a task key that isn't in the data the
 * model was given (an invented fact a teammate couldn't check). Only keys
 * with a known project prefix count, so "UTF-8" or "ISO-8601" pass.
 */
export function groundedReason(
  reason: string,
  knownKeys: ReadonlySet<string>,
  knownPrefixes: ReadonlySet<string>,
): string | null {
  if (!reason) return null;
  for (const match of reason.matchAll(TASK_KEY)) {
    const prefix = match[1] as string;
    if (knownPrefixes.has(prefix) && !knownKeys.has(match[0])) return null;
  }
  return reason;
}

/**
 * Keeps only suggestions that name a real, new option. An assignee also
 * needs work evidence: the person is assigned to one of the similar tasks,
 * the only history the model sees. A reason citing unknown tasks is dropped.
 */
export function resolveSuggestions(
  task: TriageTask,
  output: ModelOutput,
  candidates: TriageCandidates,
  tables: RefTables,
) {
  const knownKeys = new Set([
    task.key.toUpperCase(),
    ...candidates.similar.map((item) => item.key.toUpperCase()),
  ]);
  const knownPrefixes = new Set([
    ...[...knownKeys].map((key) => key.replace(/-\d+$/, "")),
    ...candidates.projects.map((project) => project.slug.toUpperCase()),
  ]);
  const reasonOf = (reason: string) =>
    groundedReason(reason, knownKeys, knownPrefixes);

  const has = new Set(task.labelNames.map((name) => name.toLowerCase()));
  const labels: { label: CandidateLabel; reason: string | null }[] = [];
  for (const entry of output.labels) {
    const label = tables.labels.get(entry.ref.toUpperCase());
    if (!label || has.has(label.name.toLowerCase())) continue;
    has.add(label.name.toLowerCase());
    labels.push({ label, reason: reasonOf(entry.reason) });
    if (labels.length >= MAX_LABELS) break;
  }

  const workedOnSimilar = new Set(
    candidates.similar.flatMap((item) => item.assigneeIds),
  );
  const assigneeEntry = output.assignee.find((entry) => {
    const person = tables.people.get(entry.ref.toUpperCase());
    return (
      person &&
      !task.assigneeIds.includes(person.id) &&
      workedOnSimilar.has(person.id) &&
      reasonOf(entry.reason) !== null
    );
  });
  const assignee = assigneeEntry
    ? {
        person: tables.people.get(
          assigneeEntry.ref.toUpperCase(),
        ) as CandidatePerson,
        reason: reasonOf(assigneeEntry.reason),
      }
    : null;

  const priorityEntry = output.priority.find(
    (entry) =>
      (VALID_PRIORITIES as readonly string[]).includes(entry.value) &&
      entry.value !== "no-priority" &&
      entry.value !== task.priority,
  );
  const priority = priorityEntry
    ? {
        value: priorityEntry.value as (typeof VALID_PRIORITIES)[number],
        reason: reasonOf(priorityEntry.reason),
      }
    : null;

  const projectEntry = output.project.find((entry) => {
    const project = tables.projects.get(entry.ref.toUpperCase());
    return project && project.id !== task.projectId;
  });
  const project = projectEntry
    ? {
        project: tables.projects.get(
          projectEntry.ref.toUpperCase(),
        ) as CandidateProject,
        reason: reasonOf(projectEntry.reason),
      }
    : null;

  const duplicates: { task: SimilarTask; reason: string | null }[] = [];
  const seen = new Set<string>();
  for (const entry of output.duplicates) {
    const similar = tables.tasks.get(entry.ref.toUpperCase());
    if (!similar || seen.has(similar.id)) continue;
    seen.add(similar.id);
    duplicates.push({ task: similar, reason: reasonOf(entry.reason) });
    if (duplicates.length >= MAX_DUPLICATES) break;
  }
  // Same title as an existing task: always worth a look, even if the model
  // passed on it. These carry no reason; the UI says "same title".
  for (const similar of candidates.similar) {
    if (duplicates.length >= MAX_DUPLICATES) break;
    if (
      similar.titleMatch &&
      similar.score >= TITLE_MATCH_SCORE &&
      !seen.has(similar.id)
    ) {
      seen.add(similar.id);
      duplicates.push({ task: similar, reason: null });
    }
  }
  return { labels, assignee, priority, project, duplicates };
}

async function autoApplyEnabled(projectId: string): Promise<boolean> {
  const [project] = await db
    .select({ autoApply: projectTable.aiTriageAutoApplyLabels })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);
  return Boolean(project?.autoApply);
}

/** POST /ai/triage/suggest */
export async function suggestTriage(
  c: Context,
  taskId: string,
  requestedLocale?: string,
) {
  const userId = c.get("userId") as string;
  const workspaceId = c.get("workspaceId") as string;
  const scope = await resolveAiScope(c);
  // Access first: a task the caller can't see is a 404 before anything else.
  const taskItems = await loadTaskContext(scope, taskId, {
    comments: 5,
    maxChars: 6000,
  });
  const task = await loadTriageTask(taskId);
  const can = await workspacePermissionChecker(c);
  const needed: Record<string, string[]> = task.isIntake
    ? { intake: ["triage"] }
    : { task: ["update"] };
  if (!can(needed)) {
    throw new HTTPException(403, { message: "Insufficient permissions" });
  }

  const candidates = await loadTriageCandidates(scope, task);
  const tables = refTables(candidates);
  const locale = requestedLocale ?? (await userLocale(userId));
  const { value } = await aiCompleteJson<unknown>({
    workspaceId,
    userId,
    feature: "triage",
    tier: "fast",
    context: [...taskItems, ...similarContextItems(scope, candidates.similar)],
    projectIds: candidates.projects.map((project) => project.id),
    system: buildSystemPrompt({ instructions: TRIAGE_INSTRUCTIONS, locale }),
    messages: [
      {
        role: "user",
        content: triagePrompt({
          task,
          taskContext: renderContext(taskItems, { maxChars: 12_000 }),
          candidates,
          tables,
        }),
      },
    ],
    jsonSchema: TRIAGE_JSON_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 2500,
    effort: "low",
  });
  const resolved = resolveSuggestions(
    task,
    parseTriageOutput(value),
    candidates,
    tables,
  );

  // Opt-in auto-apply: labels only, as the caller (label:update), audited.
  const applied = new Set<string>();
  if (
    resolved.labels.length > 0 &&
    can({ label: ["update"] }) &&
    (await autoApplyEnabled(task.projectId))
  ) {
    for (const { label } of resolved.labels) {
      try {
        await assignLabelToTask(label.id, task.id, userId);
        applied.add(label.id);
      } catch (error) {
        // A label deleted meanwhile stays a plain suggestion.
        if (!(error instanceof HTTPException)) throw error;
      }
    }
    if (applied.size > 0) {
      await recordAudit({
        workspaceId,
        action: "ai.triage_labels_applied",
        target: { type: "task", id: task.id, label: task.key },
        metadata: {
          feature: "triage",
          onBehalfOf: userId,
          labels: resolved.labels
            .filter(({ label }) => applied.has(label.id))
            .map(({ label }) => label.name),
        },
        actor: { userId },
      });
    }
  }

  return {
    taskId: task.id,
    kind: task.isIntake ? ("intake" as const) : ("task" as const),
    labels: resolved.labels.map(({ label, reason }) => ({
      labelId: label.id,
      name: label.name,
      color: label.color,
      reason,
      applied: applied.has(label.id),
    })),
    assignee: resolved.assignee
      ? {
          userId: resolved.assignee.person.id,
          name: resolved.assignee.person.name,
          image: resolved.assignee.person.image,
          reason: resolved.assignee.reason,
        }
      : null,
    priority: resolved.priority,
    project: resolved.project
      ? {
          projectId: resolved.project.project.id,
          name: resolved.project.project.name,
          slug: resolved.project.project.slug,
          reason: resolved.project.reason,
        }
      : null,
    duplicates: resolved.duplicates.map(({ task: similar, reason }) => ({
      taskId: similar.id,
      projectId: similar.projectId,
      key: similar.key,
      title: similar.title,
      status: similar.status,
      reason,
    })),
    autoApplied: applied.size > 0,
  };
}

/** GET/PATCH /ai/triage/settings/{projectId} */
export async function getTriageSettings(projectId: string) {
  return {
    projectId,
    autoApplyLabels: await autoApplyEnabled(projectId),
  };
}
