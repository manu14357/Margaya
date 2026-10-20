import { useMutation, useQueryClient } from "@tanstack/react-query";
import { analyzeCapture } from "@/fetchers/ai/capture";
import createIntakeItem from "@/fetchers/intake/create-intake-item";
import attachLabelToTask from "@/fetchers/label/attach-label-to-task";
import updateTaskAssignees from "@/fetchers/task/update-task-assignees";
import { invalidateIntakeQueries } from "@/hooks/mutations/intake/invalidate-intake-queries";
import { uploadTaskAttachment } from "@/lib/upload-task-attachment";
import type { IntakePriority } from "@/types/intake";

/** Asks for proposals; nothing is created by asking. */
export function useAnalyzeCapture() {
  return useMutation({ mutationFn: analyzeCapture });
}

export type CaptureDraft = {
  title: string;
  description: string;
  priority: IntakePriority;
  labelIds: string[];
  ownerId: string | null;
  /** Images to attach to the request's task (already without metadata). */
  files: File[];
};

export type SubmitCaptureInput = {
  projectId: string;
  drafts: CaptureDraft[];
  /** What the caller may do beyond submitting (the API checks again). */
  can: { label: boolean; assign: boolean; attach: boolean };
};

export type SubmitCaptureResult = {
  created: { id: string; taskId: string }[];
  /** Labels, owners or attachments that couldn't be added. */
  extrasFailed: number;
};

/**
 * Submits reviewed proposals one by one through the ordinary intake route,
 * then adds labels, the owner and attachments through their own routes. A
 * failed extra never undoes the request it belongs to.
 */
export async function submitCaptureDrafts({
  projectId,
  drafts,
  can,
}: SubmitCaptureInput): Promise<SubmitCaptureResult> {
  const created: SubmitCaptureResult["created"] = [];
  let extrasFailed = 0;
  const attempt = async (run: () => Promise<unknown>) => {
    try {
      await run();
    } catch {
      extrasFailed += 1;
    }
  };
  for (const draft of drafts) {
    const item = await createIntakeItem(projectId, {
      title: draft.title,
      description: draft.description,
      priority: draft.priority,
    });
    created.push({ id: item.id, taskId: item.taskId });
    if (can.label) {
      for (const labelId of draft.labelIds) {
        await attempt(() =>
          attachLabelToTask({ labelId, taskId: item.taskId }),
        );
      }
    }
    const ownerId = draft.ownerId;
    if (can.assign && ownerId) {
      await attempt(() => updateTaskAssignees(item.taskId, { add: [ownerId] }));
    }
    if (can.attach) {
      for (const file of draft.files) {
        await attempt(() =>
          uploadTaskAttachment({ taskId: item.taskId, file }),
        );
      }
    }
  }
  return { created, extrasFailed };
}

export function useSubmitCaptureDrafts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: submitCaptureDrafts,
    onSettled: (_result, _error, input) => {
      // Some requests may exist even when a later one failed.
      invalidateIntakeQueries(queryClient, { projectId: input.projectId });
    },
  });
}
