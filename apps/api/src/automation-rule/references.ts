import { and, eq, inArray } from "drizzle-orm";
import db from "../database";
import {
  agentTable,
  customFieldDefinitionTable,
  cycleTable,
  moduleTable,
  projectTable,
  workspaceUserTable,
} from "../database/schema";
import { canSeeProject } from "../project/visibility";
import { loadColumns } from "./facts";
import {
  type AutomationConditionGroup,
  type AutomationRuleDefinition,
  unknownTemplateVariables,
} from "./vocabulary";

// A rule may only name things of its own project (columns, cycles,
// modules, custom fields) and people of its workspace; people an action
// assigns or notifies must also see the project, so a restricted project's
// rule never reaches outsiders. Checked on save and by the compiler; the
// engine checks people again when it runs.

type Refs = {
  columns: Map<string, string>;
  users: Map<string, string>;
  actionUsers: Map<string, string>;
  cycles: Map<string, string>;
  modules: Map<string, string>;
  fields: Map<string, string>;
  agents: Map<string, string>;
};

function add(
  map: Map<string, string>,
  ids: readonly string[] | undefined,
  path: string,
) {
  for (const [index, id] of (ids ?? []).entries()) {
    if (!map.has(id)) map.set(id, `${path}.${index}`);
  }
}

function collectConditions(
  group: AutomationConditionGroup,
  path: string,
  refs: Refs,
  issues: string[],
) {
  for (const [index, item] of group.conditions.entries()) {
    const at = `${path}.conditions.${index}`;
    if (!("field" in item)) {
      collectConditions(item as AutomationConditionGroup, at, refs, issues);
      continue;
    }
    switch (item.field) {
      case "status":
        add(refs.columns, item.columnIds, `${at}.columnIds`);
        break;
      case "assignee":
        if (
          (item.op === "is" || item.op === "is_not") &&
          !item.userIds?.length
        ) {
          issues.push(`${at}.userIds: choose at least one person`);
        }
        add(refs.users, item.userIds, `${at}.userIds`);
        break;
      case "estimate":
        if (
          (item.op === "gte" || item.op === "lte") &&
          item.value === undefined
        ) {
          issues.push(`${at}.value: enter the points to compare with`);
        }
        break;
      case "custom_field":
        if (!refs.fields.has(item.fieldId)) {
          refs.fields.set(item.fieldId, `${at}.fieldId`);
        }
        break;
      default:
        break;
    }
  }
}

function collect(rule: AutomationRuleDefinition, issues: string[]): Refs {
  const refs: Refs = {
    columns: new Map(),
    users: new Map(),
    actionUsers: new Map(),
    cycles: new Map(),
    modules: new Map(),
    fields: new Map(),
    agents: new Map(),
  };
  const { trigger } = rule;
  switch (trigger.type) {
    case "status_changed":
      add(refs.columns, trigger.from, "trigger.from");
      add(refs.columns, trigger.to, "trigger.to");
      break;
    case "assignee_added":
    case "assignee_removed":
      add(refs.users, trigger.userIds, "trigger.userIds");
      break;
    case "moved_to_cycle":
      add(refs.cycles, trigger.cycleIds, "trigger.cycleIds");
      break;
    case "moved_to_module":
      add(refs.modules, trigger.moduleIds, "trigger.moduleIds");
      break;
    default:
      break;
  }
  if (rule.conditions) {
    collectConditions(rule.conditions, "conditions", refs, issues);
  }
  for (const [index, action] of rule.actions.entries()) {
    const at = `actions.${index}`;
    switch (action.type) {
      case "set_status":
        add(refs.columns, [action.columnId], `${at}.columnId`);
        break;
      case "assign":
      case "unassign":
        add(refs.actionUsers, action.userIds, `${at}.userIds`);
        break;
      case "notify":
        add(refs.actionUsers, action.userIds, `${at}.userIds`);
        if (!action.userIds?.length && !action.roles?.length) {
          issues.push(`${at}: choose people or roles to notify`);
        }
        break;
      case "move_to_cycle":
        add(refs.cycles, [action.cycleId], `${at}.cycleId`);
        break;
      case "move_to_module":
        add(refs.modules, [action.moduleId], `${at}.moduleId`);
        break;
      case "run_agent":
        if (!refs.agents.has(action.agentId)) {
          refs.agents.set(action.agentId, `${at}.agentId`);
        }
        break;
      default:
        break;
    }
    const texts =
      action.type === "add_comment"
        ? [action.template]
        : action.type === "create_subtask"
          ? [action.title]
          : action.type === "notify" && action.message
            ? [action.message]
            : action.type === "run_agent"
              ? [action.prompt]
              : [];
    for (const text of texts) {
      const unknown = unknownTemplateVariables(text);
      if (unknown.length > 0) {
        issues.push(
          `${at}: unknown variable ${unknown.map((name) => `{{${name}}}`).join(", ")}`,
        );
      }
    }
  }
  return refs;
}

async function existing(
  ids: string[],
  load: (ids: string[]) => Promise<{ id: string }[]>,
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  return new Set((await load(ids)).map((row) => row.id));
}

/** Problems with a rule's references for this project; empty when fine. */
export async function ruleReferenceIssues(
  projectId: string,
  rule: AutomationRuleDefinition,
): Promise<string[]> {
  const issues: string[] = [];
  const refs = collect(rule, issues);

  const [project] = await db
    .select({ workspaceId: projectTable.workspaceId })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);
  if (!project) return ["projectId: project not found"];

  const columns = await loadColumns(projectId);
  const byId = new Map(columns.map((column) => [column.id, column]));
  for (const [id, path] of refs.columns) {
    if (!byId.has(id)) issues.push(`${path}: not a column of this project`);
  }
  for (const [index, action] of rule.actions.entries()) {
    if (
      action.type === "set_status" &&
      byId.get(action.columnId)?.group === "triage"
    ) {
      issues.push(
        `actions.${index}.columnId: tasks can't be moved into triage`,
      );
    }
  }

  const userIds = [
    ...new Set([...refs.users.keys(), ...refs.actionUsers.keys()]),
  ];
  const members = await existing(userIds, (ids) =>
    db
      .select({ id: workspaceUserTable.userId })
      .from(workspaceUserTable)
      .where(
        and(
          eq(workspaceUserTable.workspaceId, project.workspaceId),
          inArray(workspaceUserTable.userId, ids),
        ),
      ),
  );
  for (const [id, path] of [...refs.users, ...refs.actionUsers]) {
    if (!members.has(id))
      issues.push(`${path}: not a member of this workspace`);
  }
  for (const [id, path] of refs.actionUsers) {
    if (members.has(id) && !(await canSeeProject(id, projectId))) {
      issues.push(`${path}: this person can't see the project`);
    }
  }

  const cycles = await existing([...refs.cycles.keys()], (ids) =>
    db
      .select({ id: cycleTable.id })
      .from(cycleTable)
      .where(
        and(eq(cycleTable.projectId, projectId), inArray(cycleTable.id, ids)),
      ),
  );
  for (const [id, path] of refs.cycles) {
    if (!cycles.has(id)) issues.push(`${path}: not a cycle of this project`);
  }

  const modules = await existing([...refs.modules.keys()], (ids) =>
    db
      .select({ id: moduleTable.id })
      .from(moduleTable)
      .where(
        and(eq(moduleTable.projectId, projectId), inArray(moduleTable.id, ids)),
      ),
  );
  for (const [id, path] of refs.modules) {
    if (!modules.has(id)) issues.push(`${path}: not a module of this project`);
  }

  const fields = await existing([...refs.fields.keys()], (ids) =>
    db
      .select({ id: customFieldDefinitionTable.id })
      .from(customFieldDefinitionTable)
      .where(
        and(
          eq(customFieldDefinitionTable.projectId, projectId),
          inArray(customFieldDefinitionTable.id, ids),
        ),
      ),
  );
  for (const [id, path] of refs.fields) {
    if (!fields.has(id))
      issues.push(`${path}: not a custom field of this project`);
  }

  if (refs.agents.size > 0) {
    const agents = await db
      .select({ id: agentTable.id, projectIds: agentTable.projectIds })
      .from(agentTable)
      .where(
        and(
          eq(agentTable.workspaceId, project.workspaceId),
          inArray(agentTable.id, [...refs.agents.keys()]),
        ),
      );
    const byAgent = new Map(agents.map((agent) => [agent.id, agent]));
    for (const [id, path] of refs.agents) {
      const agent = byAgent.get(id);
      if (!agent) issues.push(`${path}: not an agent of this workspace`);
      else if (agent.projectIds && !agent.projectIds.includes(projectId)) {
        issues.push(`${path}: this agent isn't set up to work in this project`);
      }
    }
  }

  return issues;
}
