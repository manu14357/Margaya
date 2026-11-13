import { and, eq } from "drizzle-orm";
import db from "../database";
import { columnTable, integrationTable } from "../database/schema";
import { subscribeToEvent } from "../events";
import {
  INTAKE_ITEM_UPDATED,
  type IntakeItemUpdatedEvent,
} from "../intake/events";
import { triageTaskIds } from "../intake/guards";
import type {
  IntakeDecidedEvent,
  IntegrationPlugin,
  PluginContext,
  ProjectUpdatePostedEvent,
  TaskAssigneeChangedEvent,
  TaskCommentCreatedEvent,
  TaskCreatedEvent,
  TaskDeletedEvent,
  TaskDescriptionChangedEvent,
  TaskDueDateChangedEvent,
  TaskMovedEvent,
  TaskPriorityChangedEvent,
  TaskStatusChangedEvent,
  TaskTitleChangedEvent,
  TaskUnassignedEvent,
} from "./types";

const plugins = new Map<string, IntegrationPlugin>();
let eventSubscriptionsInitialized = false;

export function registerPlugin(plugin: IntegrationPlugin): void {
  if (plugins.has(plugin.type)) {
    throw new Error(`Plugin ${plugin.type} already registered`);
  }
  plugins.set(plugin.type, plugin);
  console.log(`✓ Registered plugin: ${plugin.name}`);
}

export function initializeEventSubscriptions(): void {
  if (eventSubscriptionsInitialized) {
    return;
  }

  subscribeToEvent<{
    taskId: string;
    currentUserId?: string;
    title: string;
    description: string;
    priority: string;
    status: string;
    number: number;
    projectId: string;
  }>("task.created", async (data) => {
    await broadcastTaskCreated({
      taskId: data.taskId,
      projectId: data.projectId,
      // The creator. The payload's `userId` is the task's first assignee;
      // imports and synced issues have no Margaya actor.
      userId: data.currentUserId || null,
      title: data.title,
      description: data.description,
      priority: data.priority,
      status: data.status,
      number: data.number,
    });
  });

  subscribeToEvent<{
    taskId: string;
    userId: string | null;
    oldStatus: string;
    newStatus: string;
    title: string;
    projectId: string;
  }>("task.status_changed", async (data) => {
    await broadcastTaskStatusChanged({
      taskId: data.taskId,
      projectId: data.projectId,
      userId: data.userId,
      oldStatus: data.oldStatus,
      newStatus: data.newStatus,
      title: data.title,
    });
  });

  subscribeToEvent<{
    taskId: string;
    userId: string | null;
    oldPriority: string;
    newPriority: string;
    title: string;
    projectId: string;
  }>("task.priority_changed", async (data) => {
    await broadcastTaskPriorityChanged({
      taskId: data.taskId,
      projectId: data.projectId,
      userId: data.userId,
      oldPriority: data.oldPriority,
      newPriority: data.newPriority,
      title: data.title,
    });
  });

  subscribeToEvent<{
    taskId: string;
    userId: string | null;
    oldTitle: string;
    newTitle: string;
    projectId: string;
  }>("task.title_changed", async (data) => {
    await broadcastTaskTitleChanged({
      taskId: data.taskId,
      projectId: data.projectId,
      userId: data.userId,
      oldTitle: data.oldTitle,
      newTitle: data.newTitle,
    });
  });

  subscribeToEvent<{
    taskId: string;
    userId: string | null;
    oldDescription: string | null;
    newDescription: string | null;
    projectId: string;
  }>("task.description_changed", async (data) => {
    await broadcastTaskDescriptionChanged({
      taskId: data.taskId,
      projectId: data.projectId,
      userId: data.userId,
      oldDescription: data.oldDescription,
      newDescription: data.newDescription,
    });
  });

  subscribeToEvent<{
    taskId: string;
    userId: string;
    comment: string;
    projectId: string;
    origin?: "app" | "public_board";
    visibility?: "internal" | "public";
  }>("comment.created", async (data) => {
    await broadcastTaskCommentCreated({
      taskId: data.taskId,
      projectId: data.projectId,
      userId: data.userId,
      comment: data.comment,
      origin: data.origin ?? "app",
      visibility: data.visibility ?? "internal",
    });
  });

  subscribeToEvent<{
    taskId: string;
    userId: string | null;
    title: string;
    projectId: string;
    status?: string;
  }>("task.deleted", async (data) => {
    // The row is gone: a request deleted from intake was never announced.
    if (data.status && (await isTriageStatus(data.projectId, data.status))) {
      return;
    }
    await broadcastTaskDeleted({
      taskId: data.taskId,
      projectId: data.projectId,
      userId: data.userId,
      title: data.title,
    });
  });

  subscribeToEvent<{
    taskId: string;
    userId: string | null;
    fromProjectId: string;
    fromProjectName: string;
    toProjectId: string;
    toProjectName: string;
    oldStatus: string;
    newStatus: string;
  }>("task.moved", async (data) => {
    await broadcastTaskMoved({
      taskId: data.taskId,
      projectId: data.toProjectId,
      userId: data.userId,
      fromProjectId: data.fromProjectId,
      fromProjectName: data.fromProjectName,
      toProjectId: data.toProjectId,
      toProjectName: data.toProjectName,
      oldStatus: data.oldStatus,
      newStatus: data.newStatus,
    });
  });

  subscribeToEvent<{
    taskId: string;
    userId: string | null;
    oldDueDate: Date | null;
    newDueDate: Date | null;
    title: string;
    projectId: string;
  }>("task.due_date_changed", async (data) => {
    await broadcastTaskDueDateChanged({
      taskId: data.taskId,
      projectId: data.projectId,
      userId: data.userId,
      title: data.title,
      oldDueDate: data.oldDueDate,
      newDueDate: data.newDueDate,
    });
  });

  subscribeToEvent<{
    taskId: string;
    userId: string | null;
    oldAssignee: string | null;
    newAssignee: string | undefined;
    newAssigneeId: string;
    title: string;
    projectId: string;
    assigneeIds?: string[];
  }>("task.assignee_changed", async (data) => {
    await broadcastTaskAssigneeChanged({
      taskId: data.taskId,
      projectId: data.projectId,
      userId: data.userId,
      title: data.title,
      oldAssignee: data.oldAssignee,
      newAssignee: data.newAssignee,
      newAssigneeId: data.newAssigneeId,
      assigneeIds: data.assigneeIds,
    });
  });

  subscribeToEvent<{
    taskId: string;
    userId: string | null;
    title: string;
    projectId: string;
    oldAssigneeId?: string;
    oldAssignee?: string | null;
    assigneeIds?: string[];
  }>("task.unassigned", async (data) => {
    await broadcastTaskUnassigned({
      taskId: data.taskId,
      projectId: data.projectId,
      userId: data.userId,
      title: data.title,
      oldAssigneeId: data.oldAssigneeId,
      oldAssignee: data.oldAssignee,
      assigneeIds: data.assigneeIds,
    });
  });

  subscribeToEvent<IntakeItemUpdatedEvent>(
    INTAKE_ITEM_UPDATED,
    async (data) => {
      if (
        data.action !== "accepted" &&
        data.action !== "declined" &&
        data.action !== "duplicate"
      ) {
        return;
      }
      await broadcastIntakeDecided({
        taskId: data.taskId,
        projectId: data.projectId,
        userId: data.userId,
        decision: data.action,
        title: data.taskTitle,
        taskKey: data.taskKey,
        columnName: data.columnName ?? null,
        duplicateKey: data.duplicateKey ?? null,
      });
    },
  );

  subscribeToEvent<{
    updateId: string;
    projectId: string;
    userId: string | null;
  }>("project_update.created", async (data) => {
    await broadcastProjectUpdatePosted({
      taskId: "",
      projectId: data.projectId,
      userId: data.userId ?? null,
      updateId: data.updateId,
    });
  });

  eventSubscriptionsInitialized = true;
  console.log("✓ Plugin event subscriptions initialized");
}

export function getPlugin(type: string): IntegrationPlugin | undefined {
  return plugins.get(type);
}

export function listPlugins(): IntegrationPlugin[] {
  return Array.from(plugins.values());
}

async function getActiveIntegrations(projectId: string) {
  const integrations = await db.query.integrationTable.findMany({
    where: and(
      eq(integrationTable.projectId, projectId),
      eq(integrationTable.isActive, true),
    ),
    with: {
      project: true,
    },
  });
  // A trashed project's integrations stay quiet (C7).
  return integrations.filter((integration) => !integration.project?.deletedAt);
}

/**
 * The project's active integrations for an event about a task, or none while
 * the task waits in intake: an unreviewed request must never reach chat,
 * webhooks or issue sync (B7 K8). Accepting publishes `task.created`.
 * The triage check only runs for projects that have integrations.
 */
async function integrationsForTask(event: {
  taskId: string;
  projectId: string;
}) {
  const integrations = await getActiveIntegrations(event.projectId);
  if (integrations.length === 0) return integrations;
  const waiting = await triageTaskIds([event.taskId]);
  return waiting.length > 0 ? [] : integrations;
}

/** Whether a status is a triage column of the project (for deleted tasks). */
export async function isTriageStatus(projectId: string, status: string) {
  const [column] = await db
    .select({ id: columnTable.id })
    .from(columnTable)
    .where(
      and(
        eq(columnTable.projectId, projectId),
        eq(columnTable.slug, status),
        eq(columnTable.group, "triage"),
      ),
    )
    .limit(1);
  return Boolean(column);
}

function createContext(integration: {
  id: string;
  projectId: string;
  config: string;
}): PluginContext {
  return {
    integrationId: integration.id,
    projectId: integration.projectId,
    config: JSON.parse(integration.config) as Record<string, unknown>,
  };
}

export async function broadcastTaskCreated(
  event: TaskCreatedEvent,
): Promise<void> {
  const integrations = await integrationsForTask(event);

  for (const integration of integrations) {
    const plugin = getPlugin(integration.type);
    if (!plugin?.onTaskCreated) continue;

    const context = createContext(integration);

    try {
      await plugin.onTaskCreated(event, context);
    } catch (error) {
      console.error(`Plugin ${plugin.type} error on task.created:`, error);
    }
  }
}

export async function broadcastTaskStatusChanged(
  event: TaskStatusChangedEvent,
): Promise<void> {
  const integrations = await integrationsForTask(event);

  for (const integration of integrations) {
    const plugin = getPlugin(integration.type);
    if (!plugin?.onTaskStatusChanged) continue;

    const context = createContext(integration);

    try {
      await plugin.onTaskStatusChanged(event, context);
    } catch (error) {
      console.error(
        `Plugin ${plugin.type} error on task.status_changed:`,
        error,
      );
    }
  }
}

export async function broadcastTaskPriorityChanged(
  event: TaskPriorityChangedEvent,
): Promise<void> {
  const integrations = await integrationsForTask(event);

  for (const integration of integrations) {
    const plugin = getPlugin(integration.type);
    if (!plugin?.onTaskPriorityChanged) continue;

    const context = createContext(integration);

    try {
      await plugin.onTaskPriorityChanged(event, context);
    } catch (error) {
      console.error(
        `Plugin ${plugin.type} error on task.priority_changed:`,
        error,
      );
    }
  }
}

export async function broadcastTaskTitleChanged(
  event: TaskTitleChangedEvent,
): Promise<void> {
  const integrations = await integrationsForTask(event);

  for (const integration of integrations) {
    const plugin = getPlugin(integration.type);
    if (!plugin?.onTaskTitleChanged) continue;

    const context = createContext(integration);

    try {
      await plugin.onTaskTitleChanged(event, context);
    } catch (error) {
      console.error(
        `Plugin ${plugin.type} error on task.title_changed:`,
        error,
      );
    }
  }
}

export async function broadcastTaskDescriptionChanged(
  event: TaskDescriptionChangedEvent,
): Promise<void> {
  const integrations = await integrationsForTask(event);

  for (const integration of integrations) {
    const plugin = getPlugin(integration.type);
    if (!plugin?.onTaskDescriptionChanged) continue;

    const context = createContext(integration);

    try {
      await plugin.onTaskDescriptionChanged(event, context);
    } catch (error) {
      console.error(
        `Plugin ${plugin.type} error on task.description_changed:`,
        error,
      );
    }
  }
}

export async function broadcastTaskCommentCreated(
  event: TaskCommentCreatedEvent,
): Promise<void> {
  const integrations = await integrationsForTask(event);

  for (const integration of integrations) {
    const plugin = getPlugin(integration.type);
    if (!plugin?.onTaskCommentCreated) continue;

    const context = createContext(integration);

    try {
      await plugin.onTaskCommentCreated(event, context);
    } catch (error) {
      console.error(`Plugin ${plugin.type} error on comment.created:`, error);
    }
  }
}

export async function broadcastTaskDeleted(
  event: TaskDeletedEvent,
): Promise<void> {
  const integrations = await getActiveIntegrations(event.projectId);

  for (const integration of integrations) {
    const plugin = getPlugin(integration.type);
    if (!plugin?.onTaskDeleted) continue;

    const context = createContext(integration);

    try {
      await plugin.onTaskDeleted(event, context);
    } catch (error) {
      console.error(`Plugin ${plugin.type} error on task.deleted:`, error);
    }
  }
}

export async function broadcastTaskMoved(event: TaskMovedEvent): Promise<void> {
  const integrations = await integrationsForTask(event);

  for (const integration of integrations) {
    const plugin = getPlugin(integration.type);
    if (!plugin?.onTaskMoved) continue;

    const context = createContext(integration);

    try {
      await plugin.onTaskMoved(event, context);
    } catch (error) {
      console.error(`Plugin ${plugin.type} error on task.moved:`, error);
    }
  }
}

export async function broadcastTaskDueDateChanged(
  event: TaskDueDateChangedEvent,
): Promise<void> {
  const integrations = await integrationsForTask(event);

  for (const integration of integrations) {
    const plugin = getPlugin(integration.type);
    if (!plugin?.onTaskDueDateChanged) continue;

    const context = createContext(integration);

    try {
      await plugin.onTaskDueDateChanged(event, context);
    } catch (error) {
      console.error(
        `Plugin ${plugin.type} error on task.due_date_changed:`,
        error,
      );
    }
  }
}

export async function broadcastTaskAssigneeChanged(
  event: TaskAssigneeChangedEvent,
): Promise<void> {
  const integrations = await integrationsForTask(event);

  for (const integration of integrations) {
    const plugin = getPlugin(integration.type);
    if (!plugin?.onTaskAssigneeChanged) continue;

    const context = createContext(integration);

    try {
      await plugin.onTaskAssigneeChanged(event, context);
    } catch (error) {
      console.error(
        `Plugin ${plugin.type} error on task.assignee_changed:`,
        error,
      );
    }
  }
}

export async function broadcastTaskUnassigned(
  event: TaskUnassignedEvent,
): Promise<void> {
  const integrations = await integrationsForTask(event);

  for (const integration of integrations) {
    const plugin = getPlugin(integration.type);
    if (!plugin?.onTaskUnassigned) continue;

    const context = createContext(integration);

    try {
      await plugin.onTaskUnassigned(event, context);
    } catch (error) {
      console.error(`Plugin ${plugin.type} error on task.unassigned:`, error);
    }
  }
}

/**
 * A decision on an intake request. Not filtered by triage: a declined
 * request stays in triage, and the decision is what the channel asked for.
 * Plugins opt in per event (off by default).
 */
export async function broadcastIntakeDecided(
  event: IntakeDecidedEvent,
): Promise<void> {
  const integrations = await getActiveIntegrations(event.projectId);

  for (const integration of integrations) {
    const plugin = getPlugin(integration.type);
    if (!plugin?.onIntakeDecided) continue;

    const context = createContext(integration);

    try {
      await plugin.onIntakeDecided(event, context);
    } catch (error) {
      console.error(`Plugin ${plugin.type} error on intake decision:`, error);
    }
  }
}

/** A posted project status update (project_update.created). */
export async function broadcastProjectUpdatePosted(
  event: ProjectUpdatePostedEvent,
): Promise<void> {
  const integrations = await getActiveIntegrations(event.projectId);

  for (const integration of integrations) {
    const plugin = getPlugin(integration.type);
    if (!plugin?.onProjectUpdatePosted) continue;

    const context = createContext(integration);

    try {
      await plugin.onProjectUpdatePosted(event, context);
    } catch (error) {
      console.error(`Plugin ${plugin.type} error on project update:`, error);
    }
  }
}
