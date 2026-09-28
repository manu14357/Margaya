import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { usePublishTaskDraft } from "@/hooks/mutations/task-draft/use-publish-task-draft";
import { HttpError } from "@/lib/http-error";
import { displayTaskKey, droppedListLabel } from "@/lib/task-draft";
import { toast } from "@/lib/toast";
import type { TaskDraftPatch } from "@/types/task-draft";

/** "refused": the server said no (no project, no title...); the draft stays. */
export type PublishOutcome = "published" | "refused" | "failed";

/**
 * Publishes a draft and toasts the result: "Published WEB-12" with an Open
 * action, a warning naming the properties that could not be kept, or the
 * server's reason.
 */
export function usePublishDraftFlow(workspaceId: string) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { mutateAsync: publish } = usePublishTaskDraft();

  return useCallback(
    async (
      draftId: string,
      patch?: TaskDraftPatch,
    ): Promise<PublishOutcome> => {
      try {
        const result = await publish({ id: draftId, workspaceId, patch });
        const key = displayTaskKey(result.key);
        const action = {
          label: t("tasks:drafts.toast.open"),
          onClick: () =>
            navigate({
              to: "/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId",
              params: {
                workspaceId,
                projectId: result.task.projectId,
                taskId: result.task.id,
              },
            }),
        };
        if (result.dropped.length > 0) {
          toast.warning(
            t("tasks:drafts.toast.publishedPartial", {
              key,
              list: droppedListLabel(result.dropped, t),
            }),
            { action },
          );
        } else {
          toast.success(t("tasks:drafts.toast.published", { key }), {
            action,
          });
        }
        return "published";
      } catch (error) {
        toast.error(
          error instanceof Error && error.message
            ? error.message
            : t("tasks:drafts.toast.publishError"),
        );
        return error instanceof HttpError &&
          error.status >= 400 &&
          error.status < 500
          ? "refused"
          : "failed";
      }
    },
    [publish, workspaceId, navigate, t],
  );
}

export default usePublishDraftFlow;
