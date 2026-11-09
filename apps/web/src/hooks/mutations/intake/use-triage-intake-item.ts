import { useMutation, useQueryClient } from "@tanstack/react-query";
import acceptIntakeItem from "@/fetchers/intake/accept-intake-item";
import declineIntakeItem from "@/fetchers/intake/decline-intake-item";
import markIntakeDuplicate from "@/fetchers/intake/mark-intake-duplicate";
import reopenIntakeItem from "@/fetchers/intake/reopen-intake-item";
import snoozeIntakeItem from "@/fetchers/intake/snooze-intake-item";
import unsnoozeIntakeItem from "@/fetchers/intake/unsnooze-intake-item";
import { invalidateDeliveryQueries } from "@/hooks/mutations/delivery/invalidate-delivery-queries";
import { intakeQueryKeys } from "@/hooks/queries/intake/intake-query-keys";
import type { IntakeTriageAction } from "@/types/intake";
import {
  applyIntakeItemToLists,
  invalidateIntakeQueries,
} from "./invalidate-intake-queries";

export type TriageInput = IntakeTriageAction & {
  id: string;
  /** The queue's project, for refetching after a refused action. */
  projectId: string;
};

function runTriage(input: TriageInput) {
  switch (input.action) {
    case "accept":
      return acceptIntakeItem(input.id, input.status);
    case "decline":
      return declineIntakeItem(input.id, input.note);
    case "snooze":
      return snoozeIntakeItem(input.id, input.until);
    case "unsnooze":
      return unsnoozeIntakeItem(input.id);
    case "duplicate":
      return markIntakeDuplicate(input.id, input.duplicateOfTaskId, input.note);
    case "reopen":
      return reopenIntakeItem(input.id);
  }
}

/**
 * Accept, decline, snooze, unsnooze, mark duplicate and reopen. The server
 * decides the outcome (two triagers may race), so nothing is optimistic; a
 * refused action refetches the list and the request.
 */
export function useTriageIntakeItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: runTriage,
    onSuccess: (item, input) => {
      queryClient.setQueryData(intakeQueryKeys.item(item.id), item);
      applyIntakeItemToLists(queryClient, item);
      invalidateIntakeQueries(queryClient, {
        projectId: item.projectId,
        taskId: item.taskId,
      });
      queryClient.invalidateQueries({ queryKey: ["task", item.taskId] });
      if (input.action === "accept") {
        queryClient.invalidateQueries({
          queryKey: ["tasks", item.task.projectId],
        });
        queryClient.invalidateQueries({ queryKey: ["projects"] });
        // Out of triage, the task counts in the project's forecast.
        invalidateDeliveryQueries(queryClient, item.task.projectId);
      }
    },
    onError: (_error, input) => {
      invalidateIntakeQueries(queryClient, { projectId: input.projectId });
    },
  });
}

export default useTriageIntakeItem;
