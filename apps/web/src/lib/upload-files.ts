import type { TFunction } from "i18next";
import { HttpError } from "@/lib/http-error";
import { toast } from "@/lib/toast";
import { StorageUploadError } from "@/lib/upload-task-attachment";

/** Files taken from one pick, drop or paste; the rest get a notice. */
export const MAX_FILES_PER_UPLOAD = 10;

// The API answers an oversized upload with its limit in megabytes
// (storage/s3.ts, validateTaskAssetUploadInput).
const SIZE_LIMIT = /maximum upload size of (\d+)\s*MB/i;

export function isAbortError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

/** Whether the server stops every upload, so the rest of a batch is moot. */
function stopsBatch(error: unknown) {
  return (
    error instanceof HttpError && (error.status === 503 || error.status === 403)
  );
}

/** One file's failure, as a sentence for a toast. */
export function uploadFailureMessage(
  error: unknown,
  filename: string,
  t: TFunction,
) {
  if (error instanceof HttpError) {
    const limit = SIZE_LIMIT.exec(error.message)?.[1];
    if (limit) {
      return t("common:uploads.tooLarge", { filename, limit: `${limit} MB` });
    }
    if (error.status === 503) return t("tasks:attachments.toast.notConfigured");
    if (error.status === 403) return t("common:uploads.forbidden");
  }
  const reason =
    error instanceof StorageUploadError
      ? t("tasks:attachments.toast.storageError")
      : error instanceof Error && error.message
        ? error.message
        : t("tasks:attachments.toast.unknownError");
  return t("tasks:attachments.toast.failed", { filename, reason });
}

/**
 * Keeps the files one pick, drop or paste may upload: at most
 * MAX_FILES_PER_UPLOAD, none empty, with a toast for each one left out.
 */
export function selectUploadFiles(files: readonly File[], t: TFunction) {
  let selection = [...files];
  if (selection.length > MAX_FILES_PER_UPLOAD) {
    toast.warning(
      t("tasks:attachments.toast.tooMany", { count: MAX_FILES_PER_UPLOAD }),
    );
    selection = selection.slice(0, MAX_FILES_PER_UPLOAD);
  }
  return selection.filter((file) => {
    if (file.size > 0) return true;
    toast.error(
      t("tasks:attachments.toast.empty", { filename: file.name || "file" }),
    );
    return false;
  });
}

type UploadFilesOptions<T> = {
  files: readonly File[];
  t: TFunction;
  upload: (file: File, signal: AbortSignal) => Promise<T>;
  /** Called after each file, in order; false stops the rest (say, the editor closed). */
  onUploaded?: (result: T, file: File) => boolean | undefined;
  /** The success toast, from what uploaded; the default counts the files. */
  successMessage?: (results: T[]) => string;
};

/**
 * Uploads files one at a time behind a single progress toast ("Uploading 2
 * of 3…") with a Cancel button. Each failure gets its own toast; a server
 * without storage, or without permission, stops the batch.
 */
export async function uploadFilesWithProgress<T>({
  files,
  t,
  upload,
  onUploaded,
  successMessage,
}: UploadFilesOptions<T>): Promise<T[]> {
  const selected = selectUploadFiles(files, t);
  if (selected.length === 0) return [];

  const controller = new AbortController();
  const total = selected.length;
  const progress = (index: number) => {
    const filename = selected[index]?.name || "file";
    return total === 1
      ? { title: t("common:uploads.uploadingFile", { filename }) }
      : {
          title: t("common:uploads.uploadingProgress", {
            current: index + 1,
            total,
          }),
          description: filename,
        };
  };
  const first = progress(0);
  const toastId = toast.loading(first.title, {
    description: first.description,
    persistent: true,
    cancel: {
      label: t("common:actions.cancel"),
      onClick: () => controller.abort(),
    },
  });

  const results: T[] = [];
  let stopped = false;
  try {
    for (const [index, file] of selected.entries()) {
      if (controller.signal.aborted) break;
      if (index > 0) toast.update(toastId, progress(index));
      try {
        const result = await upload(file, controller.signal);
        if (controller.signal.aborted) break;
        results.push(result);
        if (onUploaded?.(result, file) === false) {
          stopped = true;
          break;
        }
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) break;
        toast.error(uploadFailureMessage(error, file.name || "file", t));
        if (stopsBatch(error)) break;
      }
    }
  } finally {
    toast.dismiss(toastId);
  }

  if (controller.signal.aborted) {
    toast.info(t("common:uploads.cancelled"));
  } else if (results.length > 0 && !stopped) {
    toast.success(
      successMessage?.(results) ??
        t("tasks:attachments.toast.attached", { count: results.length }),
    );
  }
  return results;
}

/** Files a drag carries (not text, links or board cards). */
export function dragCarriesFiles(
  dataTransfer: Pick<DataTransfer, "types"> | null | undefined,
) {
  return Array.from(dataTransfer?.types ?? []).includes("Files");
}
