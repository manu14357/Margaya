import { and, eq, isNull } from "drizzle-orm";
import type { Context } from "hono";
import { aiCompleteJson } from "../ai/gateway";
import { buildSystemPrompt, neutralizeTags, wrapUntrusted } from "../ai/prompt";
import { userLocale } from "../ai-translate/locale";
import db from "../database";
import {
  agentTable,
  customFieldDefinitionTable,
  cycleTable,
  integrationTable,
  labelTable,
  moduleTable,
  projectTable,
  userTable,
  workspaceUserTable,
} from "../database/schema";
import { canSeeProject } from "../project/visibility";
import {
  loadAutomationRow,
  settingsOf,
} from "../project-automation/controllers/get-automations";
import { loadProjectColumns } from "./dry-run";
import {
  checkTaskRuleReferences,
  parseUnsupported,
  resolveRules,
} from "./validate";
import {
  compilerOutputSchema,
  modelJsonSchema,
  RULE_INTEGRATIONS,
} from "./vocabulary";

// Rule compiler (C5): plain words in, a rule in an existing engine's own
// schema out. The model only writes the rule; the saved rule runs without
// it. Anything no engine can express is reported, never approximated.

export const RULE_COMPILER_INSTRUCTIONS = `You translate a request for a project automation into rules for Margaya's existing automation engines. You never run anything; a person reviews every rule before it is saved.

The engines and everything they can do:

1. Workflow rule (engine "workflow_rule"): when an event arrives from a connected GitHub or Gitea repository, the task linked to that branch, pull request or issue moves to one column of the project.
   - integrationType: "github" or "gitea".
   - eventType: "branch_push" (a branch for the task got a push), "pr_opened" (a pull request for the task was opened), "pr_merged" (its pull request was merged), "issue_opened" (an issue opened on the forge creates the task), "issue_closed" (the linked issue was closed).
   - columnId: the id of the target column, from the project's columns.
   - It has no conditions: it applies to every linked task of the project. One rule per integration and event.

2. Project automation (engine "project_automation"): fixed scheduled rules, sent as a settings change "patch".
   - autoArchive {enabled, months}: archive tasks in Completed or Cancelled columns not updated for months (1-12).
   - autoClose {enabled, months, columnId}: move open tasks not updated for months (1-12), without an upcoming start or due date, to a column of the Cancelled group. Turning it on needs columnId, chosen from the Cancelled-group columns.
   - cycleRollover {enabled}: when a cycle ends, move its unfinished tasks to the next cycle.
   - flowAlerts {enabled}: notify the project lead of a lasting change in work in progress, cycle time or throughput.
   - Send only the settings the request asks to change.

3. Automation rule (engine "automation_rule"): "When, If, Then" on one task of this project, run without a model whenever the trigger happens, by a person or anything else.
   - name: a short name for the rule, in the answer language.
   - trigger (When), one of: task_created {fromIntake?: only tasks accepted from intake}; status_changed {from?: column ids, to?: column ids}; assignee_added or assignee_removed {userIds?}; label_added or label_removed {labels?: label names}; priority_changed {to?: priorities}; due_date_set; due_date_passed (the due date of an open task passed); comment_added; moved_to_cycle {cycleIds?}; moved_to_module {moduleIds?}. A missing or empty list means any.
   - conditions (If, optional): {op: "and" or "or", conditions: [...]} where each item is a condition or one nested {op, conditions} group. Conditions: status {op: is | is_not, columnIds}; labels {op: contains | not_contains, labels}; priority {op: is | is_not, values}; assignee {op: is | is_not | empty | not_empty, userIds?}; due_date {op: set | not_set}; estimate {op: set | not_set | gte | lte, value?}; title {op: contains | not_contains, value}; custom_field {fieldId, op: equals | not_equals, value}. Conditions check the task as it is after the trigger.
   - actions (Then, 1-10, in order): set_status {columnId}; assign {userIds}; unassign {userIds, empty for everyone}; add_label {label}; remove_label {label}; set_priority {priority}; set_due_date {offsetDays: days after the run, 0-365}; add_comment {template}; move_to_cycle {cycleId}; move_to_module {moduleId}; create_subtask {title}; notify {userIds?, roles?: assignees | creator | lead, message?}; run_agent {agentId, prompt} (hands the task to one of the workspace's AI agents with the prompt as its instructions; only when the request names an agent from the list below). Templates may use {{task.title}}, {{task.key}}, {{task.status}}, {{task.priority}}, {{task.dueDate}}, {{project.name}} and {{rule.name}}.
   - Priorities: no-priority, low, medium, high, urgent. Task types are labels (a "bug" is a task with the label bug) when such a label exists.
   - People, labels, cycles, modules, custom fields and agents must come from the lists below; match names case-insensitively.

Rules:
- A rule must do exactly what the request asks, never more and never something else. Use only the triggers, conditions, actions, settings and ids listed above, with ids copied exactly.
- Prefer the engine that expresses the request exactly: integration events are workflow rules, scheduled clean-up is a project automation, anything that reacts to a change of a task is an automation rule.
- Never approximate. If a trigger, condition or action has no exact counterpart (for example another project, a person, label, cycle or column that is not listed, or an action on other tasks), do not emit a rule that would fire more broadly or do something different. Put that part in "unsupported" with a one-sentence reason instead.
- When a condition of the request cannot be checked, the whole rule it belongs to is unsupported.
- Independent parts that the engines can express fully still become rules.
- Match column names case-insensitively; if no column clearly matches, the part is unsupported.
- Write "request" and "reason" in the answer language. Return only the JSON.`;

async function connectedIntegrations(projectId: string): Promise<string[]> {
  const rows = await db
    .select({ type: integrationTable.type })
    .from(integrationTable)
    .where(
      and(
        eq(integrationTable.projectId, projectId),
        eq(integrationTable.isActive, true),
      ),
    );
  return rows
    .map((row) => row.type)
    .filter((type) => (RULE_INTEGRATIONS as readonly string[]).includes(type));
}

/** What automation rules may name: people, labels, cycles, modules, fields. */
async function taskRuleVocabulary(projectId: string): Promise<string> {
  const [project] = await db
    .select({ workspaceId: projectTable.workspaceId })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);
  if (!project) return "";
  const members = await db
    .select({ id: userTable.id, name: userTable.name, kind: userTable.kind })
    .from(workspaceUserTable)
    .innerJoin(userTable, eq(userTable.id, workspaceUserTable.userId))
    .where(eq(workspaceUserTable.workspaceId, project.workspaceId))
    .limit(200);
  const people: string[] = [];
  for (const member of members) {
    if (member.kind === "agent") continue;
    if (await canSeeProject(member.id, projectId)) {
      people.push(`${member.id}: ${member.name}`);
    }
  }
  const labels = await db
    .selectDistinct({ name: labelTable.name })
    .from(labelTable)
    .where(eq(labelTable.workspaceId, project.workspaceId))
    .limit(200);
  const cycles = await db
    .select({ id: cycleTable.id, name: cycleTable.name })
    .from(cycleTable)
    .where(
      and(eq(cycleTable.projectId, projectId), isNull(cycleTable.archivedAt)),
    )
    .limit(100);
  const modules = await db
    .select({ id: moduleTable.id, name: moduleTable.name })
    .from(moduleTable)
    .where(
      and(eq(moduleTable.projectId, projectId), isNull(moduleTable.archivedAt)),
    )
    .limit(100);
  const fields = await db
    .select({
      id: customFieldDefinitionTable.id,
      name: customFieldDefinitionTable.name,
      type: customFieldDefinitionTable.type,
    })
    .from(customFieldDefinitionTable)
    .where(eq(customFieldDefinitionTable.projectId, projectId))
    .limit(100);
  const agents = await db
    .select({ id: agentTable.id, name: agentTable.name })
    .from(agentTable)
    .where(
      and(
        eq(agentTable.workspaceId, project.workspaceId),
        eq(agentTable.enabled, true),
      ),
    )
    .limit(50);
  const list = (rows: string[]) => rows.join("\n") || "(none)";
  const named = (rows: { id: string; name: string }[]) =>
    list(rows.map((row) => `${row.id}: ${row.name}`));
  return [
    "People who can be assigned or notified (id: name):",
    wrapUntrusted({ source: "people", text: list(people) }),
    "Labels (names):",
    wrapUntrusted({
      source: "labels",
      text: list(labels.map((row) => row.name)),
    }),
    "Cycles (id: name):",
    wrapUntrusted({ source: "cycles", text: named(cycles) }),
    "Modules (id: name):",
    wrapUntrusted({ source: "modules", text: named(modules) }),
    "Custom fields (id: name (type)):",
    wrapUntrusted({
      source: "custom_fields",
      text: list(fields.map((row) => `${row.id}: ${row.name} (${row.type})`)),
    }),
    "AI agents for run_agent (agent id: name):",
    wrapUntrusted({ source: "agents", text: named(agents) }),
  ].join("\n\n");
}

type ModelOutput = { rules?: unknown; unsupported?: unknown };

/** POST /ai/rules/compile */
export async function compileRule(
  c: Context,
  input: { projectId: string; prompt: string; locale?: string },
) {
  const userId = c.get("userId") as string;
  const workspaceId = c.get("workspaceId") as string;
  const { projectId } = input;

  const columns = await loadProjectColumns(projectId);
  const integrations = await connectedIntegrations(projectId);
  const settings = settingsOf(await loadAutomationRow(projectId));
  const outputSchema = compilerOutputSchema({
    all: columns.map((column) => column.id),
    cancelled: columns
      .filter((column) => column.group === "cancelled")
      .map((column) => column.id),
  });

  const columnLines = columns
    .map((column) => `${column.id}: ${column.name} (group: ${column.group})`)
    .join("\n");
  const current = [
    `Connected integrations: ${integrations.join(", ") || "none"}`,
    `Current settings: autoArchive ${settings.autoArchiveEnabled ? "on" : "off"} (${settings.autoArchiveMonths} months), autoClose ${settings.autoCloseEnabled ? "on" : "off"} (${settings.autoCloseMonths} months), cycleRollover ${settings.cycleRolloverEnabled ? "on" : "off"}, flowAlerts ${settings.flowAlertsEnabled ? "on" : "off"}`,
  ].join("\n");
  const content = [
    "The project's columns (id: name (group)):",
    wrapUntrusted({ source: "columns", text: columnLines || "(none)" }),
    current,
    await taskRuleVocabulary(projectId),
    "The request, written by the person asking:",
    `<request>\n${neutralizeTags(input.prompt)}\n</request>`,
    "Return the rules and the unsupported parts as JSON.",
  ].join("\n\n");

  const locale = input.locale ?? (await userLocale(userId));
  const { value } = await aiCompleteJson<ModelOutput>({
    workspaceId,
    userId,
    feature: "rule_compiler",
    tier: "balanced",
    projectIds: [projectId],
    system: buildSystemPrompt({
      instructions: RULE_COMPILER_INSTRUCTIONS,
      locale,
    }),
    messages: [{ role: "user", content }],
    jsonSchema: modelJsonSchema(outputSchema),
    maxTokens: 4096,
    effort: "low",
  });

  const raw = (value && typeof value === "object" ? value : {}) as ModelOutput;
  const resolved = resolveRules(raw.rules, columns);
  // Automation rules also name people, labels, cycles and modules.
  const rules: typeof resolved.rules = [];
  let rejected = resolved.rejected;
  for (const rule of resolved.rules) {
    if ((await checkTaskRuleReferences(projectId, rule)).length > 0) {
      rejected += 1;
    } else {
      rules.push(rule);
    }
  }
  const unsupported = parseUnsupported(raw.unsupported);
  const status =
    rules.length === 0
      ? "unsupported"
      : unsupported.length > 0 || rejected > 0
        ? "partial"
        : "compiled";
  return { projectId, status, rules, unsupported, rejected } as const;
}
