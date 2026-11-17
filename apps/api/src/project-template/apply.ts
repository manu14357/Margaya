import { markdownToJson } from "@margaya/editor-schema";
import { templateElements } from "@margaya/whiteboard";
import { createId } from "@paralleldrive/cuid2";
import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import * as Y from "yjs";
import { automationRuleDefinitionSchema } from "../automation-rule/vocabulary";
import {
  activityTable,
  automationRuleTable,
  columnTable,
  customFieldDefinitionTable,
  customFieldValueTable,
  cycleTable,
  cycleTaskTable,
  estimatePointTable,
  estimateTable,
  intakeFormTable,
  labelTable,
  moduleTable,
  moduleTaskTable,
  pageTable,
  pageTemplateTable,
  projectAutomationTable,
  projectTable,
  projectTemplateApplicationTable,
  projectUpdateReminderTable,
  savedViewTable,
  taskAssigneeTable,
  taskRecurrenceTable,
  taskRelationTable,
  taskTable,
  taskTemplateTable,
  whiteboardTable,
} from "../database/schema";
import { arrangePoints } from "../estimate/positions";
import { buildPageContent } from "../page/content";
import { PAGE_TEMPLATE_LIMIT } from "../page/templates";
import { generateLinkToken } from "../publication/token";
import type { Transaction } from "../task/assignee-writes";
import { shiftDate } from "../utils/calendar-date";
import { startOfLocalDayUtc } from "../utils/zoned-date";
import {
  assertViewDisplay,
  assertViewDisplayProperties,
  assertViewFilters,
} from "../view/validate";
import { DEFAULT_BOARD_SETTINGS, encodeBoardState } from "../whiteboard/board";
import { projectionsOf } from "../whiteboard/persistence";
import {
  type BuiltPage,
  buildIntakeForm,
  buildPages,
  buildPageTemplates,
  buildProjectAutomation,
  buildRule,
  buildTaskTemplates,
  buildView,
  placeholderRefs,
  planSampleData,
  type TemplateRefs,
  whiteboardLabels,
} from "./build";
import type { ResolvedTemplate } from "./resolve";
import type { AppliedTemplate } from "./types";

// ResolvedTemplate -> rows, inside the create-project transaction. One
// multi-row insert per kind, in dependency order, with ids generated here so
// references never depend on RETURNING order. No events: the caller
// publishes project.created (and label.changed) after commit, and sample
// tasks get one "create" history row each instead of task.created, which
// would fire the template's own rules and notify assignees.

export type PreparedTemplate = {
  resolved: ResolvedTemplate;
  pages: (BuiltPage & ReturnType<typeof buildPageContent>)[];
  whiteboards: {
    title: string;
    icon: string | null;
    state: Uint8Array;
    contentText: string;
    elementCount: number;
  }[];
};

function definitionBug(message: string): never {
  throw new HTTPException(500, {
    message: `Template definition error: ${message}`,
  });
}

/**
 * CPU work done before the transaction (no locks held): page documents,
 * whiteboard states, and a structural check of views and rules against the
 * real validators. A mismatch is a definition bug: it answers 500 before
 * anything is written.
 */
export function prepareTemplate(resolved: ResolvedTemplate): PreparedTemplate {
  const refs = placeholderRefs();
  for (const view of resolved.definition.views ?? []) {
    const built = buildView(resolved, view, refs);
    try {
      assertViewFilters(built.filters, {
        scope: "project",
        workspaceId: "workspace-template-check",
        userId: refs.userId,
      });
      assertViewDisplay(built.display, "project");
      assertViewDisplayProperties(built.displayProperties, "project");
    } catch (error) {
      definitionBug(
        `view "${built.name}": ${error instanceof Error ? error.message : error}`,
      );
    }
  }
  for (const rule of resolved.definition.automationRules ?? []) {
    const built = buildRule(resolved, rule, refs);
    if (!built) continue;
    const { enabled: _enabled, ...definition } = built;
    const parsed = automationRuleDefinitionSchema.safeParse(definition);
    if (!parsed.success) {
      definitionBug(`rule "${built.name}": ${parsed.error.issues[0]?.message}`);
    }
  }

  const pages = buildPages(resolved).map((page) => ({
    ...page,
    ...buildPageContent(markdownToJson(page.markdown)),
  }));
  const whiteboards = (resolved.definition.whiteboards ?? []).map((board) => {
    const elements = templateElements(
      board.board,
      whiteboardLabels(resolved, board.board),
    );
    const state = encodeBoardState(elements, { ...DEFAULT_BOARD_SETTINGS });
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    const projections = projectionsOf(doc);
    doc.destroy();
    return {
      title: resolved.t(board.title).trim(),
      icon: board.icon ?? null,
      state: projections.state,
      contentText: projections.contentText,
      elementCount: projections.elementCount,
    };
  });
  return { resolved, pages, whiteboards };
}

export type ApplyInput = {
  projectId: string;
  workspaceId: string;
  userId: string;
  prepared: PreparedTemplate;
  /** label:create: new workspace labels may be inserted. */
  canCreateLabels: boolean;
  /** Write the sample tasks (the route checked task:create). */
  sampleData: boolean;
  /** The workspace's local date and zone, for sample dates. */
  today: string;
  timeZone: string;
  /** Workspace starters keep each project's examples short. */
  maxSampleTasks?: number;
};

export type ApplyResult = {
  applied: AppliedTemplate;
  sampleTaskIds: string[];
  labelsInserted: boolean;
};

export async function applyTemplate(
  tx: Transaction,
  input: ApplyInput,
): Promise<ApplyResult> {
  const { projectId, workspaceId, userId, prepared } = input;
  const { resolved } = prepared;
  const definition = resolved.definition;
  const skipped: AppliedTemplate["skipped"] = [];

  // 1. Columns.
  const columnIds = new Map<string, string>();
  const columnGroups = new Map<string, string>();
  await tx.insert(columnTable).values(
    resolved.columns.map((column) => {
      const id = createId();
      columnIds.set(column.key, id);
      columnGroups.set(column.key, column.group);
      return {
        id,
        projectId,
        name: column.name,
        slug: column.slug,
        position: column.position,
        icon: column.icon,
        color: column.color,
        group: column.group,
        isFinal: column.isFinal,
      };
    }),
  );

  // 2. Workspace labels, reused by name.
  const labelIds = new Map<string, string>();
  let labelsInserted = false;
  if (resolved.labels.length > 0) {
    if (input.canCreateLabels) {
      const inserted = await tx
        .insert(labelTable)
        .values(
          resolved.labels.map((label) => ({
            name: label.name,
            color: label.color,
            workspaceId,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: labelTable.id });
      labelsInserted = inserted.length > 0;
    }
    const existing = await tx
      .select({
        id: labelTable.id,
        name: labelTable.name,
        deletionStartedAt: labelTable.deletionStartedAt,
      })
      .from(labelTable)
      .where(
        and(
          eq(labelTable.workspaceId, workspaceId),
          isNull(labelTable.taskId),
          inArray(
            labelTable.name,
            resolved.labels.map((label) => label.name),
          ),
        ),
      );
    const byName = new Map(existing.map((row) => [row.name, row]));
    for (const label of resolved.labels) {
      const row = byName.get(label.name);
      if (row && !row.deletionStartedAt) labelIds.set(label.key, row.id);
      else {
        skipped.push({
          kind: "label",
          key: label.key,
          reason: row ? "deleting" : "permission",
        });
      }
    }
  }

  // 3. Custom fields.
  const fieldIds = new Map<string, string>();
  if (resolved.fields.length > 0) {
    await tx.insert(customFieldDefinitionTable).values(
      resolved.fields.map((field) => {
        const id = createId();
        fieldIds.set(field.key, id);
        return {
          id,
          projectId,
          name: field.name,
          type: field.type,
          required: field.required,
          defaultValue: field.defaultValue,
          options: field.options,
          position: field.position,
        };
      }),
    );
  }

  // 4. Estimate system (active) and its points.
  const pointIds = new Map<string, string>();
  if (resolved.estimate) {
    const estimateId = createId();
    await tx.insert(estimateTable).values({
      id: estimateId,
      projectId,
      name: resolved.estimate.name,
      type: resolved.estimate.type,
      isActive: true,
      createdBy: userId,
    });
    const points = arrangePoints(
      resolved.estimate.type,
      resolved.estimate.points.map((point) => {
        if (!point.point) definitionBug(`estimate value "${point.value}"`);
        return { ...point.point, definitionValue: point.value, id: createId() };
      }),
    );
    await tx.insert(estimatePointTable).values(
      points.map((point) => {
        pointIds.set(point.definitionValue, point.id);
        return {
          id: point.id,
          estimateId,
          value: point.value,
          numericValue: point.numericValue,
          position: point.position,
        };
      }),
    );
  }

  // 5. Modules.
  const moduleIds = new Map<string, string>();
  const modules = definition.modules ?? [];
  if (modules.length > 0) {
    await tx.insert(moduleTable).values(
      modules.map((module, position) => {
        const id = createId();
        moduleIds.set(module.key, id);
        return {
          id,
          projectId,
          name: resolved.t(module.name).trim(),
          description: module.description
            ? resolved.t(module.description)
            : null,
          status: module.status ?? "backlog",
          position,
          createdBy: userId,
        };
      }),
    );
  }

  const refs: TemplateRefs = {
    userId,
    columnId: (key) => columnIds.get(key) ?? definitionBug(`column ${key}`),
    labelId: (key) => labelIds.get(key) ?? null,
    fieldId: (key) => fieldIds.get(key) ?? definitionBug(`field ${key}`),
    moduleId: (key) => moduleIds.get(key) ?? definitionBug(`module ${key}`),
    pointId: (value) => pointIds.get(value) ?? null,
  };

  // 6. Task templates.
  const taskTemplates = buildTaskTemplates(resolved, refs);
  if (taskTemplates.length > 0) {
    await tx
      .insert(taskTemplateTable)
      .values(
        taskTemplates.map((row) => ({ ...row, projectId, createdBy: userId })),
      );
  }

  // 7. Saved views.
  const views = (definition.views ?? []).map((view) =>
    buildView(resolved, view, refs),
  );
  if (views.length > 0) {
    await tx.insert(savedViewTable).values(
      views.map((view) => ({
        workspaceId,
        projectId,
        name: view.name,
        description: view.description,
        filters: view.filters,
        display: view.display,
        displayProperties: view.displayProperties,
        access: view.access,
        ownerId: userId,
      })),
    );
  }

  // 8. Automation rules (a rule naming a skipped label is skipped).
  const rules = (definition.automationRules ?? []).flatMap((rule, index) => {
    const built = buildRule(resolved, rule, refs);
    if (!built) {
      skipped.push({
        kind: "automationRule",
        key: String(index),
        reason: "permission",
      });
      return [];
    }
    return [built];
  });
  if (rules.length > 0) {
    await tx.insert(automationRuleTable).values(
      rules.map((rule) => ({
        projectId,
        name: rule.name,
        enabled: rule.enabled,
        triggerType: rule.trigger.type,
        trigger: rule.trigger,
        conditions: rule.conditions ?? null,
        actions: rule.actions,
        createdBy: userId,
        updatedBy: userId,
      })),
    );
  }

  // 9. Scheduled automations.
  const automation = buildProjectAutomation(resolved, refs);
  if (automation) {
    await tx.insert(projectAutomationTable).values({
      projectId,
      ...automation,
      cycleRolloverSince: automation.cycleRolloverEnabled
        ? shiftDate(input.today, -1)
        : null,
      updatedBy: userId,
    });
  }

  // 10. Request form, always off.
  const form = buildIntakeForm(resolved, refs);
  if (form) {
    await tx
      .insert(intakeFormTable)
      .values({ projectId, token: generateLinkToken(), ...form });
  }

  // 11. Update reminder.
  if (definition.updateReminder) {
    await tx.insert(projectUpdateReminderTable).values({
      projectId,
      enabled: definition.updateReminder.enabled,
      weekday: definition.updateReminder.weekday ?? 5,
    });
  }

  // 12. Pages, then page templates under the workspace cap.
  if (prepared.pages.length > 0) {
    const pageIds = new Map(
      prepared.pages.map((page) => [page.key, createId()]),
    );
    const now = new Date();
    await tx.insert(pageTable).values(
      prepared.pages.map((page) => ({
        id: pageIds.get(page.key) as string,
        workspaceId,
        projectId,
        parentId: page.parentKey ? (pageIds.get(page.parentKey) ?? null) : null,
        position: page.position,
        title: page.title,
        logoKind: page.logoKind,
        logoValue: page.logoValue,
        access: "public" as const,
        ownerId: userId,
        isFullWidth: page.isFullWidth,
        contentYjs: page.contentYjs,
        contentMarkdown: page.contentMarkdown,
        contentText: page.contentText,
        contentVersion: 1,
        createdById: userId,
        updatedById: userId,
        createdAt: now,
        updatedAt: now,
      })),
    );
  }
  const pageTemplates = buildPageTemplates(resolved);
  if (pageTemplates.length > 0) {
    const [{ total } = { total: 0 }] = await tx
      .select({ total: count() })
      .from(pageTemplateTable)
      .where(eq(pageTemplateTable.workspaceId, workspaceId));
    const room = Math.max(0, PAGE_TEMPLATE_LIMIT - Number(total));
    const now = new Date();
    if (room > 0) {
      await tx.insert(pageTemplateTable).values(
        pageTemplates.slice(0, room).map((template) => ({
          workspaceId,
          projectId,
          ...template,
          createdById: userId,
          createdAt: now,
          updatedAt: now,
        })),
      );
    }
    pageTemplates.slice(room).forEach((_, index) => {
      skipped.push({
        kind: "pageTemplate",
        key: String(room + index),
        reason: "limit",
      });
    });
  }

  // 13. Whiteboards (template boards hold no task cards).
  if (prepared.whiteboards.length > 0) {
    await tx.insert(whiteboardTable).values(
      prepared.whiteboards.map((board) => ({
        workspaceId,
        projectId,
        title: board.title,
        icon: board.icon,
        contentYjs: Buffer.from(board.state),
        contentText: board.contentText,
        elementCount: board.elementCount,
        createdById: userId,
        updatedById: userId,
      })),
    );
  }

  // 14. Sample data.
  const sampleTaskIds = input.sampleData
    ? await writeSampleData(tx, {
        input,
        refs,
        columnGroups,
        labelIds,
        fieldIds,
        moduleIds,
      })
    : [];

  await tx.insert(projectTemplateApplicationTable).values({
    projectId,
    templateId: definition.id,
    templateVersion: definition.version,
    locale: resolved.locale,
    sampleTaskIds,
    appliedBy: userId,
  });

  return {
    applied: {
      id: definition.id,
      version: definition.version,
      locale: resolved.locale,
      sampleTaskCount: sampleTaskIds.length,
      skipped,
    },
    sampleTaskIds,
    labelsInserted,
  };
}

async function writeSampleData(
  tx: Transaction,
  {
    input,
    refs,
    columnGroups,
    labelIds,
    fieldIds,
    moduleIds,
  }: {
    input: ApplyInput;
    refs: TemplateRefs;
    columnGroups: Map<string, string>;
    labelIds: Map<string, string>;
    fieldIds: Map<string, string>;
    moduleIds: Map<string, string>;
  },
): Promise<string[]> {
  const { projectId, workspaceId, userId, prepared, timeZone } = input;
  const { resolved } = prepared;
  const plan = planSampleData(resolved, input.today, {
    maxTasks: input.maxSampleTasks,
  });
  if (plan.tasks.length === 0) return [];
  const now = new Date();
  const instant = (date: string | null) =>
    date ? startOfLocalDayUtc(date, timeZone) : null;

  const cycleIds = plan.cycles.map(() => createId());
  if (plan.cycles.length > 0) {
    await tx.insert(cycleTable).values(
      plan.cycles.map((cycle, index) => ({
        id: cycleIds[index] as string,
        projectId,
        name: cycle.name,
        startDate: cycle.startDate,
        endDate: cycle.endDate,
        ownerId: userId,
        createdBy: userId,
        // Same spacing as the cycle API: later cycles sort first.
        sortOrder: 65535 - index * 10000,
      })),
    );
  }

  const taskIds = new Map(plan.tasks.map((task) => [task.key, createId()]));
  const idOf = (key: string) => taskIds.get(key) as string;
  const slugOf = new Map(
    resolved.columns.map((column) => [column.key, column.slug]),
  );
  await tx.insert(taskTable).values(
    plan.tasks.map((task) => ({
      id: idOf(task.key),
      projectId,
      number: task.number,
      position: task.position,
      title: task.title,
      description: task.description,
      status: slugOf.get(task.columnKey) ?? "",
      columnId: refs.columnId(task.columnKey),
      priority: task.priority,
      startDate: instant(task.startDate),
      dueDate: instant(task.dueDate),
      isMilestone: task.isMilestone,
      completedAt:
        columnGroups.get(task.columnKey) === "completed" ? now : null,
      userId: task.assignCreator ? userId : null,
      createdBy: userId,
      estimatePointId: task.estimateValue
        ? refs.pointId(task.estimateValue)
        : null,
    })),
  );
  await tx
    .update(projectTable)
    .set({ lastTaskNumber: plan.tasks.length })
    .where(eq(projectTable.id, projectId));

  const assigned = plan.tasks.filter((task) => task.assignCreator);
  if (assigned.length > 0) {
    await tx.insert(taskAssigneeTable).values(
      assigned.map((task) => ({
        taskId: idOf(task.key),
        userId,
        position: 0,
      })),
    );
  }

  const labelColor = new Map(
    resolved.labels.map((label) => [label.key, label]),
  );
  const labelRows = plan.tasks.flatMap((task) =>
    task.labelKeys.flatMap((key) => {
      const label = labelColor.get(key);
      return label && labelIds.has(key)
        ? [
            {
              taskId: idOf(task.key),
              name: label.name,
              color: label.color,
              workspaceId,
            },
          ]
        : [];
    }),
  );
  if (labelRows.length > 0) await tx.insert(labelTable).values(labelRows);

  const valueRows = plan.tasks.flatMap((task) =>
    Object.entries(task.fieldValues).flatMap(([fieldKey, value]) => {
      const fieldId = fieldIds.get(fieldKey);
      return fieldId ? [{ taskId: idOf(task.key), fieldId, value }] : [];
    }),
  );
  if (valueRows.length > 0) {
    await tx.insert(customFieldValueTable).values(valueRows);
  }

  if (plan.relations.length > 0) {
    await tx.insert(taskRelationTable).values(
      plan.relations.map((relation) => ({
        sourceTaskId: idOf(relation.from),
        targetTaskId: idOf(relation.to),
        relationType: relation.type,
      })),
    );
  }

  const moduleRows = plan.tasks.flatMap((task) => {
    const moduleId = task.moduleKey ? moduleIds.get(task.moduleKey) : null;
    return moduleId
      ? [{ moduleId, taskId: idOf(task.key), createdBy: userId }]
      : [];
  });
  if (moduleRows.length > 0)
    await tx.insert(moduleTaskTable).values(moduleRows);

  const cycleRows = plan.tasks.flatMap((task) => {
    const cycleId =
      task.cycleIndex !== null ? cycleIds[task.cycleIndex] : undefined;
    return cycleId
      ? [{ taskId: idOf(task.key), cycleId, addedBy: userId }]
      : [];
  });
  if (cycleRows.length > 0) await tx.insert(cycleTaskTable).values(cycleRows);

  const recurring = plan.tasks.filter((task) => task.recurrence);
  if (recurring.length > 0) {
    await tx.insert(taskRecurrenceTable).values(
      recurring.map((task) => {
        const rule = task.recurrence as NonNullable<typeof task.recurrence>;
        return {
          taskId: idOf(task.key),
          frequency: rule.frequency,
          interval: rule.interval,
          weekdays: rule.weekdays,
          monthDay: rule.monthDay,
          trigger: rule.trigger,
          anchorDate: rule.anchorDate,
          nextRunDate: rule.nextRunDate,
          createdBy: userId,
        };
      }),
    );
  }

  await tx.insert(activityTable).values(
    plan.tasks.map((task) => ({
      taskId: idOf(task.key),
      type: "create",
      userId,
      content: null,
      eventData: { templateId: resolved.definition.id, sample: true },
    })),
  );

  return plan.tasks.map((task) => idOf(task.key));
}
