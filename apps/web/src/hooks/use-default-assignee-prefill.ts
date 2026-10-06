import { useCallback, useEffect, useRef } from "react";
import { prefillAssignees } from "@/lib/default-assignee";

/**
 * Keeps a create form's assignees on the project default until the user
 * changes them. Switching projects re-applies the new project's default
 * while the field is untouched. `reset` re-arms it (e.g. "create more").
 */
export function useDefaultAssigneePrefill({
  defaultAssigneeUserId,
  initiallyChosen,
  setAssigneeIds,
}: {
  defaultAssigneeUserId: string | null | undefined;
  /** True when the form opened with assignees decided (draft, handoff). */
  initiallyChosen: boolean;
  setAssigneeIds: (ids: string[]) => void;
}) {
  const touchedRef = useRef(initiallyChosen);
  const defaultRef = useRef(defaultAssigneeUserId);
  defaultRef.current = defaultAssigneeUserId;

  useEffect(() => {
    if (touchedRef.current) return;
    setAssigneeIds(prefillAssignees(defaultAssigneeUserId));
  }, [defaultAssigneeUserId, setAssigneeIds]);

  const markTouched = useCallback(() => {
    touchedRef.current = true;
  }, []);

  const reset = useCallback(() => {
    touchedRef.current = false;
    setAssigneeIds(prefillAssignees(defaultRef.current));
  }, [setAssigneeIds]);

  return { markTouched, reset };
}
