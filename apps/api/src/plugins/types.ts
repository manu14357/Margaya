export type PluginContext = {
  integrationId: string;
  projectId: string;
  config: Record<string, unknown>;
};

export type TaskCreatedEvent = {
  taskId: string;
  projectId: string;
  /** Who created the task; null when no Margaya user did (imports, sync). */
  userId: string | null;
  title: string;
  description: string | null;
  priority: string | null;
  status: string;
  number: number;
};

export type TaskStatusChangedEvent = {
  taskId: string;
  projectId: string;
  userId: string | null;
  oldStatus: string;
  newStatus: string;
  title: string;
};

export type TaskPriorityChangedEvent = {
  taskId: string;
  projectId: string;
  userId: string | null;
  oldPriority: string;
  newPriority: string;
  title: string;
};

export type TaskTitleChangedEvent = {
  taskId: string;
  projectId: string;
  userId: string | null;
  oldTitle: string;
  newTitle: string;
};

export type TaskDescriptionChangedEvent = {
  taskId: string;
  projectId: string;
  userId: string | null;
  oldDescription: string | null;
  newDescription: string | null;
};

export type TaskCommentCreatedEvent = {
  taskId: string;
  projectId: string;
  userId: string;
  comment: string;
  /** B12: where the comment was written; public board text is outsider text. */
  origin?: "app" | "public_board";
  visibility?: "internal" | "public";
};

export type TaskDeletedEvent = {
  taskId: string;
  projectId: string;
  userId: string | null;
  title: string;
};

export type TaskMovedEvent = {
  taskId: string;
  projectId: string;
  userId: string | null;
  fromProjectId: string;
  fromProjectName: string;
  toProjectId: string;
  toProjectName: string;
  oldStatus: string;
  newStatus: string;
};

export type TaskDueDateChangedEvent = {
  taskId: string;
  projectId: string;
  userId: string | null;
  title: string;
  oldDueDate: Date | null;
  newDueDate: Date | null;
};

/** Fired once per added assignee. */
export type TaskAssigneeChangedEvent = {
  taskId: string;
  projectId: string;
  userId: string | null;
  title: string;
  /** The first assignee's id before the change, or null. */
  oldAssignee: string | null;
  newAssignee: string | undefined;
  newAssigneeId: string;
  /** Every assignee after the change, first assignee first. */
  assigneeIds?: string[];
};

/** Fired once per removed assignee. */
export type TaskUnassignedEvent = {
  taskId: string;
  projectId: string;
  userId: string | null;
  title: string;
  /** The removed user; absent from legacy publishers. */
  oldAssigneeId?: string;
  /** The removed user's name. */
  oldAssignee?: string | null;
  /** Every assignee after the change, first assignee first. */
  assigneeIds?: string[];
};

export type TaskEvent =
  | TaskCreatedEvent
  | TaskStatusChangedEvent
  | TaskPriorityChangedEvent
  | TaskTitleChangedEvent
  | TaskDescriptionChangedEvent
  | TaskCommentCreatedEvent
  | TaskDeletedEvent
  | TaskMovedEvent
  | TaskDueDateChangedEvent
  | TaskAssigneeChangedEvent
  | TaskUnassignedEvent;

export type ExternalMetadata = {
  type: "issue" | "pull_request" | "branch";
  id: string;
  externalId: string;
  title: string | null;
  url: string;
  status: string;
  metadata: Record<string, unknown>;
};

export type TaskEventHandler<T extends TaskEvent = TaskEvent> = (
  event: T,
  context: PluginContext,
) => Promise<void>;

export type WebhookHandler = (
  payload: unknown,
  headers: Record<string, string>,
) => Promise<void>;

export type MetadataProvider = (
  taskId: string,
  context: PluginContext,
) => Promise<ExternalMetadata[]>;

export type ConfigValidator = (
  config: unknown,
) => Promise<{ valid: boolean; errors?: string[] }>;

export type IntegrationPlugin = {
  type: string;
  name: string;

  onTaskCreated?: TaskEventHandler<TaskCreatedEvent>;
  onTaskStatusChanged?: TaskEventHandler<TaskStatusChangedEvent>;
  onTaskPriorityChanged?: TaskEventHandler<TaskPriorityChangedEvent>;
  onTaskTitleChanged?: TaskEventHandler<TaskTitleChangedEvent>;
  onTaskDescriptionChanged?: TaskEventHandler<TaskDescriptionChangedEvent>;
  onTaskCommentCreated?: TaskEventHandler<TaskCommentCreatedEvent>;
  onTaskDeleted?: TaskEventHandler<TaskDeletedEvent>;
  onTaskMoved?: TaskEventHandler<TaskMovedEvent>;
  onTaskDueDateChanged?: TaskEventHandler<TaskDueDateChangedEvent>;
  onTaskAssigneeChanged?: TaskEventHandler<TaskAssigneeChangedEvent>;
  onTaskUnassigned?: TaskEventHandler<TaskUnassignedEvent>;

  handleWebhook?: WebhookHandler;
  getTaskMetadata?: MetadataProvider;
  validateConfig: ConfigValidator;
};
