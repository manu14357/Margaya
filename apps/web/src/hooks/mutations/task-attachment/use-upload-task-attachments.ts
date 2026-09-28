import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { taskAttachmentsQueryKey } from "@/hooks/queries/task-attachment/use-get-task-attachments";
import { HttpError } from "@/lib/http-error";
import { toast } from "@/lib/toast";
import {
  StorageUploadError,
  uploadTaskAttachment,
} from "@/lib/upload-task-attachment";

/** Files taken from one pick or drop; the rest are dropped with a notice. */
export const MAX_FILES_PER_BATCH = 10;

export type PendingUpload = { id: string; filename: string };

type Entry = PendingUpload & { file: File };

/**
 * Uploads picked or dropped files to the task's Attachments panel one at a
 * time. Each file shows as a pending row until its attachment is listed; a
 * failure is reported per file, and a server without storage stops the batch.
 */
export function useUploadTaskAttachments(taskId: string) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const nextId = useRef(0);

  const failureReason = useCallback(
    (error: unknown) => {
      if (error instanceof StorageUploadError) {
        return t("tasks:attachments.toast.storageError");
      }
      if (error instanceof Error && error.message) return error.message;
      return t("tasks:attachments.toast.unknownError");
    },
    [t],
  );

  const runBatch = useCallback(
    async (entries: Entry[]) => {
      const drop = (ids: string[]) =>
        setPending((current) =>
          current.filter((upload) => !ids.includes(upload.id)),
        );
      let attached = 0;
      for (const [index, entry] of entries.entries()) {
        try {
          await uploadTaskAttachment({ taskId, file: entry.file });
          attached += 1;
          // The listed row replaces the pending one without a gap.
          await queryClient.invalidateQueries({
            queryKey: taskAttachmentsQueryKey(taskId),
          });
          void queryClient.invalidateQueries({
            queryKey: ["activities", taskId],
          });
          drop([entry.id]);
        } catch (error) {
          if (error instanceof HttpError && error.status === 503) {
            toast.error(t("tasks:attachments.toast.notConfigured"));
            drop(entries.slice(index).map((rest) => rest.id));
            break;
          }
          toast.error(
            t("tasks:attachments.toast.failed", {
              filename: entry.filename,
              reason: failureReason(error),
            }),
          );
          drop([entry.id]);
        }
      }
      if (attached > 0) {
        toast.success(
          t("tasks:attachments.toast.attached", { count: attached }),
        );
      }
    },
    [failureReason, queryClient, t, taskId],
  );

  const upload = useCallback(
    (files: readonly File[]) => {
      if (files.length === 0) return;
      let selection = [...files];
      if (selection.length > MAX_FILES_PER_BATCH) {
        toast.warning(
          t("tasks:attachments.toast.tooMany", { count: MAX_FILES_PER_BATCH }),
        );
        selection = selection.slice(0, MAX_FILES_PER_BATCH);
      }

      const entries: Entry[] = [];
      for (const file of selection) {
        const filename = file.name || "file";
        if (file.size === 0) {
          toast.error(t("tasks:attachments.toast.empty", { filename }));
          continue;
        }
        nextId.current += 1;
        entries.push({ id: `upload-${nextId.current}`, filename, file });
      }
      if (entries.length === 0) return;

      setPending((current) => [
        ...current,
        ...entries.map(({ id, filename }) => ({ id, filename })),
      ]);
      // Batches run one after another, so files still go up one at a time.
      queue.current = queue.current
        .then(() => runBatch(entries))
        .catch(() => undefined);
    },
    [runBatch, t],
  );

  return { pending, upload };
}

export default useUploadTaskAttachments;
