// The project's default assignee prefills new-task forms. It is only a
// starting value: the user can remove it, and a form whose assignees were
// already chosen (a draft, a capture-bar handoff) keeps them.

/** The assignees a fresh form starts with for a project. */
export function prefillAssignees(
  defaultAssigneeUserId: string | null | undefined,
): string[] {
  return defaultAssigneeUserId ? [defaultAssigneeUserId] : [];
}

/**
 * The capture bar's assignees: typed `@people` win; otherwise the project
 * default unless the user dismissed it for this entry.
 */
export function captureAssignees(
  typed: readonly string[],
  defaultAssigneeUserId: string | null | undefined,
  dismissed: boolean,
): string[] {
  if (typed.length > 0) return [...typed];
  return dismissed ? [] : prefillAssignees(defaultAssigneeUserId);
}
