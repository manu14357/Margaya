import { BUILD_LABEL_COLORS, BUILD_PRIORITIES } from "../ai-build/schema";
import { z } from "../openapi";
import { RELATION_INPUT_NAMES } from "../task-relation/types";
import { isValidDateString } from "../utils/calendar-date";

// Build mode in chat: a prompt becomes a list of ACTIONS the person reviews
// (edit, remove, confirm). Each action is one ordinary API call made with
// the caller's own credentials, so a plan can never do more than the person
// could do by hand. Actions may point at things an earlier action of the
// same plan creates through temp refs (`projectRef: "p1"` after an action
// with `refs.tempId: "p1"`).

/** A plan is reviewable at a glance and bounded when applied. */
export const MAX_ACTIONS = 50;
export const MAX_CONTEXT_ITEMS = 10;
export const MAX_HISTORY_TURNS = 6;
export const MAX_IDS_PER_ACTION = 50;

export const ACTION_OPS = [
  "create_project",
  "create_task",
  "update_task",
  "set_status",
  "assign",
  "add_comment",
  "create_cycle",
  "add_to_cycle",
  "create_module",
  "add_to_module",
  "create_page",
  "link_tasks",
  "create_label",
  "delete_task",
  "run_agent",
] as const;
export type ActionOp = (typeof ACTION_OPS)[number];

/** Ops that create something a later action can point at. */
export const CREATING_OPS = {
  create_project: "project",
  create_task: "task",
  create_cycle: "cycle",
  create_module: "module",
} as const satisfies Partial<Record<ActionOp, string>>;
export type RefKind = (typeof CREATING_OPS)[keyof typeof CREATING_OPS];

export const DESTRUCTIVE_OPS: readonly ActionOp[] = ["delete_task"];

export const PROBLEM_CODES = [
  // The caller lacks the permission the action needs.
  "forbidden",
  // A project, task, cycle, module, member or agent that isn't there (or
  // the caller can't see it).
  "not_found",
  // A name that matches more than one member; see candidates.
  "ambiguous",
  // A temp ref with no earlier action that creates it.
  "unresolved_ref",
  // The project has cycles or modules turned off.
  "feature_off",
  // Anything else that can't be applied as written.
  "invalid",
] as const;
export type ProblemCode = (typeof PROBLEM_CODES)[number];

const id = z.string().trim().min(1).max(64);
const tempRef = z.string().trim().min(1).max(40);
const ids = z.array(id).max(MAX_IDS_PER_ACTION);
const refs = z.array(tempRef).max(MAX_IDS_PER_ACTION);
const calendarDay = z
  .string()
  .refine(isValidDateString, {
    message: "Use a real calendar date in YYYY-MM-DD form",
  })
  .openapi({ format: "date" });
const priority = z.enum(BUILD_PRIORITIES);

const projectTarget = {
  projectId: id.optional().openapi({ description: "An existing project." }),
  projectRef: tempRef.optional().openapi({
    description: "The tempId of a create_project action earlier in the plan.",
  }),
};
const taskTarget = {
  taskId: id.optional().openapi({ description: "An existing task." }),
  taskRef: tempRef.optional().openapi({
    description: "The tempId of a create_task action earlier in the plan.",
  }),
};

export const actionParamsSchemas = {
  create_project: z.object({
    name: z.string().trim().min(1).max(120),
    key: z
      .string()
      .trim()
      .regex(/^[\p{L}\p{N}]{2,8}$/u, "2 to 8 letters or digits")
      .optional(),
    description: z.string().max(5000).optional(),
    leadUserId: id.optional(),
  }),
  create_task: z.object({
    ...projectTarget,
    title: z.string().trim().min(1).max(255),
    description: z.string().max(10_000).optional(),
    priority: priority.optional(),
    status: z.string().trim().min(1).max(80).optional().openapi({
      description: "A column slug of the project; omitted: its first column.",
    }),
    assigneeIds: ids.optional(),
    dueDate: calendarDay.optional(),
    labels: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
    parentTaskId: id.optional(),
    parentRef: tempRef.optional(),
  }),
  update_task: z.object({
    ...taskTarget,
    fields: z
      .object({
        title: z.string().trim().min(1).max(255).optional(),
        description: z.string().max(10_000).optional(),
        priority: priority.optional(),
        dueDate: calendarDay.nullable().optional(),
      })
      .refine((fields) => Object.keys(fields).length > 0, "Nothing to update"),
  }),
  set_status: z.object({
    ...taskTarget,
    status: z.string().trim().min(1).max(80),
  }),
  assign: z.object({
    ...taskTarget,
    userIds: ids.min(1),
  }),
  add_comment: z.object({
    ...taskTarget,
    content: z.string().trim().min(1).max(10_000),
  }),
  create_cycle: z.object({
    ...projectTarget,
    name: z.string().trim().min(1).max(255),
    startDate: calendarDay.optional(),
    endDate: calendarDay.optional(),
  }),
  add_to_cycle: z.object({
    cycleId: id.optional(),
    cycleRef: tempRef.optional(),
    taskIds: ids.optional(),
    taskRefs: refs.optional(),
  }),
  create_module: z.object({
    ...projectTarget,
    name: z.string().trim().min(1).max(255),
    description: z.string().max(5000).optional(),
  }),
  add_to_module: z.object({
    moduleId: id.optional(),
    moduleRef: tempRef.optional(),
    taskIds: ids.optional(),
    taskRefs: refs.optional(),
  }),
  create_page: z.object({
    ...projectTarget,
    title: z.string().trim().min(1).max(255),
    content: z.string().max(100_000),
  }),
  link_tasks: z.object({
    ...taskTarget,
    targetTaskId: id.optional(),
    targetRef: tempRef.optional(),
    relationType: z.enum(RELATION_INPUT_NAMES),
  }),
  create_label: z.object({
    name: z.string().trim().min(1).max(40),
    color: z.enum(BUILD_LABEL_COLORS),
  }),
  delete_task: z.object({ taskId: id }),
  run_agent: z.object({
    ...taskTarget,
    agentId: id,
    prompt: z.string().trim().min(1).max(4000),
  }),
} as const satisfies Record<ActionOp, z.ZodType>;

export type ActionParams<O extends ActionOp = ActionOp> = z.output<
  (typeof actionParamsSchemas)[O]
>;

export const problemSchema = z
  .object({
    code: z.enum(PROBLEM_CODES),
    message: z.string(),
    field: z.string().optional().openapi({
      description: "The param the problem is in, e.g. assigneeIds.",
    }),
    value: z.string().optional().openapi({
      description: "The value that didn't resolve, e.g. a name.",
    }),
    candidates: z
      .array(z.object({ id: z.string(), name: z.string() }))
      .optional()
      .openapi({
        description: "For ambiguous: the members the name could mean.",
      }),
  })
  .openapi("ChatBuildProblem");

const actionBase = {
  id: z.string().trim().min(1).max(40).openapi({
    description: "The action's id within the plan (a1, a2, …).",
  }),
  title: z.string().trim().min(1).max(300).openapi({
    description: 'What it does, e.g. "Create project NX-7 Sensor Fusion".',
  }),
  detail: z.string().max(2000).optional(),
  risk: z.enum(["write", "destructive"]).openapi({
    description:
      "destructive actions (deleting) need an explicit tick in the app.",
  }),
  refs: z.object({ tempId: tempRef.optional() }).optional().openapi({
    description:
      "tempId: how later actions of the plan point at what this one creates.",
  }),
  problem: problemSchema.nullable().optional().openapi({
    description:
      "Why the action can't be applied as written (it is skipped on apply).",
  }),
};

function actionVariant<O extends ActionOp>(op: O) {
  return z.object({
    ...actionBase,
    op: z.literal(op),
    params: actionParamsSchemas[op],
  });
}

export const actionSchema = z
  .discriminatedUnion("op", [
    actionVariant("create_project"),
    actionVariant("create_task"),
    actionVariant("update_task"),
    actionVariant("set_status"),
    actionVariant("assign"),
    actionVariant("add_comment"),
    actionVariant("create_cycle"),
    actionVariant("add_to_cycle"),
    actionVariant("create_module"),
    actionVariant("add_to_module"),
    actionVariant("create_page"),
    actionVariant("link_tasks"),
    actionVariant("create_label"),
    actionVariant("delete_task"),
    actionVariant("run_agent"),
  ])
  .openapi("ChatBuildAction");

export type ChatBuildAction = z.output<typeof actionSchema>;
export type ChatBuildProblem = z.output<typeof problemSchema>;

export const CONTEXT_KINDS = [
  "task",
  "page",
  "project",
  "cycle",
  "module",
  "member",
  "agent",
] as const;

const workspaceId = z.string().min(1);

export const planBody = z
  .object({
    workspaceId,
    projectId: z.string().min(1).optional().openapi({
      description: "The project the chat is about (the default target).",
    }),
    prompt: z.string().trim().min(1).max(4000),
    history: z
      .array(
        z.object({
          question: z.string().max(4000),
          answer: z.string().max(8000),
        }),
      )
      .max(MAX_HISTORY_TURNS)
      .optional()
      .openapi({ description: "Earlier turns, oldest first." }),
    context: z
      .array(z.object({ kind: z.enum(CONTEXT_KINDS), id: z.string().min(1) }))
      .max(MAX_CONTEXT_ITEMS)
      .optional()
      .openapi({
        description:
          "Items the person @-mentioned; loaded fresh and permission-checked.",
      }),
    autopilot: z.boolean().optional().openapi({
      description:
        "Apply the plan right away when the workspace allows Autopilot (and the plan has no problems and nothing destructive).",
    }),
  })
  .openapi("ChatBuildPlanInput");
export type PlanBody = z.output<typeof planBody>;

export const applyBody = z
  .object({
    workspaceId,
    actions: z.array(actionSchema).min(1).max(MAX_ACTIONS),
    confirmDestructive: z
      .array(z.string())
      .max(MAX_ACTIONS)
      .optional()
      .openapi({
        description:
          "Ids of destructive actions the person ticked; others are skipped.",
      }),
  })
  .openapi("ChatBuildApplyInput");

export const undoBody = z
  .object({
    workspaceId,
    undoToken: z.string().min(1).max(200_000),
  })
  .openapi("ChatBuildUndoInput");
