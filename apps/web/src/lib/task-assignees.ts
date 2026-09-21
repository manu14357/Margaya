// Pure helpers for task assignees. A task has an ordered list of assignees
// (`assigneeIds`, first assignee first); `userId` and the `assignee*` fields
// only mirror the first one. Read the list through `assigneesOfTask`, never
// through `userId`, so "assigned to X" means X is anywhere in the list.

/** The most assignees one task can have; the API enforces the same limit. */
export const MAX_TASK_ASSIGNEES = 20;

/** Assignee filter token for tasks with no assignees. */
export const ASSIGNEE_FILTER_NONE = "none";

/** Assignee filter token for the viewing user. */
export const ASSIGNEE_FILTER_ME = "me";

/** A person as the API embeds them in tasks: id, display name and avatar. */
export type TaskAssignee = { id: string; name: string; image: string | null };

/** An assignee resolved for display. */
export type AssigneeEntry = TaskAssignee & {
  /** Still assigned, but no longer an active member of the workspace. */
  isFormerMember: boolean;
  /** Known only by id; shown as "Unknown person". */
  isUnknown: boolean;
};

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The assignee fields every task shape carries (board, detail, relations). */
export type AssigneeFields = {
  userId?: string | null;
  assigneeIds?: readonly string[] | null;
  assignees?: readonly TaskAssignee[] | null;
  assigneeName?: string | null;
  assigneeImage?: string | null;
};

const NO_ASSIGNEES: readonly string[] = [];

/**
 * The task's assignee ids, first assignee first. Cache entries written before
 * multi-assignee (or optimistic ones) may lack `assigneeIds`; they fall back
 * to the mirrored `userId`.
 */
export function assigneesOfTask(task: AssigneeFields): readonly string[] {
  if (task.assigneeIds) return task.assigneeIds;
  return task.userId ? [task.userId] : NO_ASSIGNEES;
}

export function isAssignedTo(
  task: AssigneeFields,
  userId: string | null | undefined,
): boolean {
  return Boolean(userId) && assigneesOfTask(task).includes(userId as string);
}

/**
 * Any-of assignee filter: no values match everything; `none` matches tasks
 * without assignees and `me` stands for the viewing user.
 */
export function matchesAssigneeFilter(
  task: AssigneeFields,
  values: readonly string[] | null | undefined,
  currentUserId?: string | null,
): boolean {
  if (!values || values.length === 0) return true;
  const ids = assigneesOfTask(task);
  return values.some((value) => {
    if (value === ASSIGNEE_FILTER_NONE) return ids.length === 0;
    const userId = value === ASSIGNEE_FILTER_ME ? currentUserId : value;
    return Boolean(userId) && ids.includes(userId as string);
  });
}

/**
 * The groups a task belongs to when grouped by assignee: one per assignee,
 * or the `none` group. A task with several assignees appears in each group.
 */
export function assigneeGroupKeys(task: AssigneeFields): string[] {
  const ids = assigneesOfTask(task);
  return ids.length > 0 ? [...ids] : [ASSIGNEE_FILTER_NONE];
}

/**
 * The embedded assignees of a task, for surfaces without a member list
 * (the public board). Older cache entries only have the mirrored first one.
 */
export function embeddedAssignees(task: AssigneeFields): TaskAssignee[] {
  if (task.assignees) return [...task.assignees];
  if (!task.userId) return [];
  return [
    {
      id: task.userId,
      name: task.assigneeName ?? "",
      image: task.assigneeImage ?? null,
    },
  ];
}

const peopleIndexes = new WeakMap<
  readonly TaskAssignee[],
  Map<string, TaskAssignee>
>();

/** An id index of a people list, built once per list. */
function indexPeople(people: readonly TaskAssignee[]) {
  let index = peopleIndexes.get(people);
  if (!index) {
    index = new Map(people.map((person) => [person.id, person]));
    peopleIndexes.set(people, index);
  }
  return index;
}

/**
 * Resolves assignee ids to display entries, in order. Active members win;
 * then the task's embedded data, then an unknown placeholder. With the member
 * list still loading (`members` undefined) nobody is flagged as former.
 */
export function resolveAssignees(
  ids: readonly string[],
  members: readonly TaskAssignee[] | undefined,
  embedded: readonly TaskAssignee[] = [],
): AssigneeEntry[] {
  const memberIndex = members ? indexPeople(members) : undefined;
  return ids.map((id) => {
    const member = memberIndex?.get(id);
    if (member) return { ...member, isFormerMember: false, isUnknown: false };
    const isFormerMember = memberIndex !== undefined;
    const known = embedded.find((person) => person.id === id);
    if (known) return { ...known, isFormerMember, isUnknown: false };
    return { id, name: "", image: null, isFormerMember, isUnknown: true };
  });
}

/**
 * The picker's row order: the current assignees in assignee order, then the
 * viewing user, then every other member in member-list order.
 */
export function pickerOrder(
  selectedIds: readonly string[],
  members: readonly TaskAssignee[],
  currentUserId?: string | null,
): string[] {
  const order = new Set(selectedIds);
  if (currentUserId && members.some((member) => member.id === currentUserId)) {
    order.add(currentUserId);
  }
  for (const member of members) order.add(member.id);
  return [...order];
}

export function assigneeDisplayName(
  entry: Pick<TaskAssignee, "name">,
  t: Translate,
): string {
  return entry.name || t("tasks:assignees.unknownPerson");
}

/** "Unassigned", the one name, or "{first name} +{others}". */
export function formatAssigneeSummary(
  entries: readonly Pick<TaskAssignee, "name">[],
  t: Translate,
): string {
  const [first] = entries;
  if (!first) return t("tasks:assignee.unassigned");
  const name = assigneeDisplayName(first, t);
  if (entries.length === 1) return name;
  return t("tasks:assignees.nameAndMore", {
    name,
    count: entries.length - 1,
  });
}

/** How many entries a stack of `max` faces leaves for the "+N" chip. */
export function overflowCount(total: number, max: number): number {
  return Math.max(0, total - Math.max(0, max));
}

/** Removals first, then additions appended in order (the API's PATCH rule). */
export function patchAssigneeIds(
  ids: readonly string[],
  {
    add = [],
    remove = [],
  }: { add?: readonly string[]; remove?: readonly string[] },
): string[] {
  const removing = new Set(remove);
  const next = ids.filter((id) => !removing.has(id));
  for (const id of add) if (!next.includes(id)) next.push(id);
  return next;
}

/**
 * Undoes one failed patch on the current list, leaving any other change made
 * meanwhile: users it added leave, users it removed return to their old place.
 */
export function revertAssigneePatch(
  ids: readonly string[],
  previous: readonly string[],
  {
    add = [],
    remove = [],
  }: { add?: readonly string[]; remove?: readonly string[] },
): string[] {
  const added = new Set(add.filter((id) => !previous.includes(id)));
  const next = ids.filter((id) => !added.has(id));
  for (const id of remove) {
    const at = previous.indexOf(id);
    if (at === -1 || next.includes(id)) continue;
    next.splice(Math.min(at, next.length), 0, id);
  }
  return next;
}

/**
 * The task with `ids` as its assignees, the mirror fields following the first
 * one. Names come from the task itself, then `people`.
 */
export function withAssignees<T extends AssigneeFields>(
  task: T,
  ids: readonly string[],
  people: readonly TaskAssignee[] = [],
): T {
  const known = new Map<string, TaskAssignee>();
  for (const person of people) known.set(person.id, person);
  for (const person of embeddedAssignees(task)) known.set(person.id, person);
  const assignees = ids.map(
    (id) => known.get(id) ?? { id, name: "", image: null },
  );
  const first = assignees[0];
  return {
    ...task,
    assigneeIds: [...ids],
    assignees,
    userId: first?.id ?? null,
    assigneeId: first?.id ?? null,
    assigneeName: first ? first.name || null : null,
    assigneeImage: first?.image ?? null,
  };
}

/** Every assignee of any of the tasks, in first-seen order. */
export function assigneeUnion(tasks: readonly AssigneeFields[]): string[] {
  const union = new Set<string>();
  for (const task of tasks) {
    for (const id of assigneesOfTask(task)) union.add(id);
  }
  return [...union];
}

/**
 * For a multi-task picker: who is assigned to every task (`all`) and who to
 * only some of them (`some`), each in first-seen order.
 */
export function sharedAssignees(tasks: readonly AssigneeFields[]): {
  all: string[];
  some: string[];
} {
  const union = assigneeUnion(tasks);
  const lists = tasks.map(assigneesOfTask);
  const all = union.filter((id) => lists.every((ids) => ids.includes(id)));
  const some = union.filter((id) => !all.includes(id));
  return { all, some };
}

/** The largest assignee count among the tasks. */
export function maxAssigneeCount(tasks: readonly AssigneeFields[]): number {
  return tasks.reduce(
    (max, task) => Math.max(max, assigneesOfTask(task).length),
    0,
  );
}

type MemberList = {
  members?: ReadonlyArray<{
    userId: string;
    user?: { name?: string | null; image?: string | null } | null;
  }>;
};

const peopleCache = new WeakMap<object, TaskAssignee[]>();

/**
 * The active workspace members (as the member list query returns them) as
 * people, built once per query result so every consumer shares one array.
 */
export function peopleFromMembers(
  data: MemberList | null | undefined,
): TaskAssignee[] | undefined {
  if (!data) return undefined;
  let people = peopleCache.get(data);
  if (!people) {
    people = (data.members ?? []).map((member) => ({
      id: member.userId,
      name: member.user?.name ?? "",
      image: member.user?.image ?? null,
    }));
    peopleCache.set(data, people);
  }
  return people;
}
