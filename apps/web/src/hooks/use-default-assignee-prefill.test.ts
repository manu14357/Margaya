import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { useDefaultAssigneePrefill } from "./use-default-assignee-prefill";

function usePrefilledForm(
  defaultAssigneeUserId: string | null,
  initiallyChosen = false,
  initial: string[] = [],
) {
  const [assigneeIds, setAssigneeIds] = useState<string[]>(initial);
  const prefill = useDefaultAssigneePrefill({
    defaultAssigneeUserId,
    initiallyChosen,
    setAssigneeIds,
  });
  return { assigneeIds, setAssigneeIds, ...prefill };
}

describe("useDefaultAssigneePrefill", () => {
  it("prefills the default and follows a project switch while untouched", () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => usePrefilledForm(id),
      { initialProps: { id: "u1" as string | null } },
    );
    expect(result.current.assigneeIds).toEqual(["u1"]);

    rerender({ id: "u2" });
    expect(result.current.assigneeIds).toEqual(["u2"]);

    rerender({ id: null });
    expect(result.current.assigneeIds).toEqual([]);
  });

  it("keeps the user's choice once they touch the field", () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => usePrefilledForm(id),
      { initialProps: { id: "u1" as string | null } },
    );
    act(() => {
      result.current.markTouched();
      result.current.setAssigneeIds([]);
    });
    rerender({ id: "u2" });
    expect(result.current.assigneeIds).toEqual([]);

    act(() => result.current.reset());
    expect(result.current.assigneeIds).toEqual(["u2"]);
  });

  it("never overrides assignees a form opened with", () => {
    const { result } = renderHook(() => usePrefilledForm("u1", true, ["u9"]));
    expect(result.current.assigneeIds).toEqual(["u9"]);
  });
});
