const PRIORITIES = ["no-priority", "low", "medium", "high", "urgent"] as const;

export type TaskPriority = (typeof PRIORITIES)[number];

export function isTaskPriority(v: string): v is TaskPriority {
  return (PRIORITIES as readonly string[]).includes(v);
}

export type TaskUpdatePatch = {
  title?: string;
  description?: string | null;
  status?: string;
  priority?: TaskPriority;
  projectId?: string;
  position?: number;
  startDate?: string | null;
  dueDate?: string | null;
  userId?: string | null;
  /** Replaces every assignee; null or [] clears them. */
  assigneeIds?: string[] | null;
};

export type TaskUpdateBody = Record<
  string,
  string | number | string[] | undefined
>;

/**
 * Builds the JSON body for `PUT /api/task/:id` from an existing task plus a patch.
 */
export function buildFullTaskUpdateBody(
  existing: Record<string, unknown>,
  patch: TaskUpdatePatch,
): TaskUpdateBody {
  const positionRaw = patch.position ?? existing.position;
  const position =
    typeof positionRaw === "number"
      ? positionRaw
      : typeof positionRaw === "string"
        ? Number(positionRaw)
        : Number.NaN;
  if (!Number.isFinite(position)) {
    throw new Error(
      "Cannot update task: missing numeric `position` on existing task.",
    );
  }

  const title =
    patch.title ??
    (typeof existing.title === "string" ? existing.title : undefined);
  if (!title) {
    throw new Error("Cannot update task: missing title.");
  }

  const description =
    patch.description !== undefined
      ? patch.description === null
        ? ""
        : String(patch.description)
      : existing.description == null
        ? ""
        : String(existing.description);

  const status =
    patch.status ??
    (typeof existing.status === "string" ? existing.status : undefined);
  if (!status) {
    throw new Error("Cannot update task: missing status.");
  }

  const priorityRaw =
    patch.priority ??
    (typeof existing.priority === "string" ? existing.priority : undefined);
  if (!priorityRaw || !isTaskPriority(priorityRaw)) {
    throw new Error("Cannot update task: invalid or missing priority.");
  }

  const projectId =
    patch.projectId ??
    (typeof existing.projectId === "string" ? existing.projectId : undefined);
  if (!projectId) {
    throw new Error("Cannot update task: missing projectId.");
  }

  // When patch.userId is explicitly null, we send userId "" so the API clears every assignee.
  // When patch.userId is undefined, we echo existing.userId (the first assignee): the API keeps
  // every assignee then, the others included. patch.assigneeIds, when set, is sent instead of
  // userId and replaces the whole list (null or [] clears it).
  const userId =
    patch.userId !== undefined
      ? patch.userId === null
        ? ""
        : patch.userId
      : typeof existing.userId === "string"
        ? existing.userId
        : undefined;

  const assigneeIds =
    patch.assigneeIds === undefined
      ? undefined
      : patch.assigneeIds === null
        ? []
        : patch.assigneeIds;

  const startDate = formatOptionalIso(
    patch.startDate !== undefined ? patch.startDate : existing.startDate,
  );
  const dueDate = formatOptionalIso(
    patch.dueDate !== undefined ? patch.dueDate : existing.dueDate,
  );

  const body: TaskUpdateBody = {
    title,
    description,
    status,
    priority: priorityRaw,
    projectId,
    position,
  };

  if (startDate !== undefined) {
    body.startDate = startDate;
  }
  if (dueDate !== undefined) {
    body.dueDate = dueDate;
  }
  if (assigneeIds !== undefined) {
    body.assigneeIds = assigneeIds;
  } else if (userId !== undefined) {
    body.userId = userId;
  }

  return body;
}

function formatOptionalIso(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}
