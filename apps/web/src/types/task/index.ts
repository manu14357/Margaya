type TaskLabel = {
  id: string;
  name: string;
  color: string;
};

type TaskExternalLink = {
  id: string;
  taskId: string;
  integrationId: string;
  resourceType: string;
  externalId: string;
  url: string;
  title: string | null;
  metadata: Record<string, unknown> | null;
};

type TaskCustomFieldValue = {
  fieldId: string;
  value: string | null;
};

type TaskAssignee = {
  id: string;
  name: string;
  image: string | null;
};

type Task = {
  id: string;
  title: string;
  number: number | null;
  description: string | null;
  descriptionDeferred?: boolean;
  status: string;
  priority: string | null;
  startDate: string | null;
  dueDate: string | null;
  position: number | null;
  createdAt: string;
  updatedAt?: string;
  /** The first assignee; `assigneeIds` holds all of them. */
  userId: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  assigneeImage?: string | null;
  /**
   * Every assignee, first first. Optional because optimistic and older cache
   * entries may lack it: read it through `assigneesOfTask` (lib/task-assignees).
   */
  assigneeIds?: string[];
  /** Every assignee's id, name and avatar, first first (board and detail). */
  assignees?: TaskAssignee[];
  projectId: string;
  columnId?: string | null;
  /** The task's cycle; null when it has none or cycles are off. */
  cycleId?: string | null;
  /** A point of the project's active estimate system, or null. */
  estimatePointId?: string | null;
  /** Set while the task is archived; archived tasks keep their column. */
  archivedAt?: string | null;
  /** Who created the task; null for integration-made tasks. */
  createdBy?: string | null;
  labels?: TaskLabel[];
  externalLinks?: TaskExternalLink[];
  customFieldValues?: TaskCustomFieldValue[];
};

export default Task;
