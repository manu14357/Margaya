import type { TFunction } from "i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import {
  MAX_FILES_PER_UPLOAD,
  uploadFailureMessage,
  uploadFilesWithProgress,
} from "./upload-files";
import { StorageUploadError } from "./upload-task-attachment";

const toast = vi.hoisted(() => ({
  loading: vi.fn(
    (_title: string, _options?: { cancel?: { onClick?: () => void } }) =>
      "toast-1",
  ),
  update: vi.fn(),
  dismiss: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));
vi.mock("@/lib/toast", () => ({ toast }));

const t = ((key: string, options?: Record<string, unknown>) =>
  options ? `${key} ${JSON.stringify(options)}` : key) as unknown as TFunction;

const file = (name: string, body = "x") => new File([body], name);

afterEach(() => vi.clearAllMocks());

describe("uploadFailureMessage", () => {
  it("names the size limit the server answers with", () => {
    const error = new HttpError(
      400,
      "Upload exceeds the maximum upload size of 10MB.",
    );
    expect(uploadFailureMessage(error, "big.pdf", t)).toBe(
      'common:uploads.tooLarge {"filename":"big.pdf","limit":"10 MB"}',
    );
  });

  it("explains a missing permission and a server without storage", () => {
    expect(uploadFailureMessage(new HttpError(403, "Forbidden"), "a", t)).toBe(
      "common:uploads.forbidden",
    );
    expect(uploadFailureMessage(new HttpError(503, "Off"), "a", t)).toBe(
      "tasks:attachments.toast.notConfigured",
    );
  });

  it("gives the file and a reason for anything else", () => {
    expect(uploadFailureMessage(new StorageUploadError(500), "a.txt", t)).toBe(
      'tasks:attachments.toast.failed {"filename":"a.txt","reason":"tasks:attachments.toast.storageError"}',
    );
  });
});

describe("uploadFilesWithProgress", () => {
  it("uploads every file in order behind one progress toast", async () => {
    const upload = vi.fn(async (picked: File) => picked.name);
    const onUploaded = vi.fn();
    const results = await uploadFilesWithProgress({
      files: [file("a.pdf"), file("b.png"), file("c.txt")],
      t,
      upload,
      onUploaded,
    });

    expect(results).toEqual(["a.pdf", "b.png", "c.txt"]);
    expect(onUploaded.mock.calls.map(([result]) => result)).toEqual([
      "a.pdf",
      "b.png",
      "c.txt",
    ]);
    expect(toast.loading).toHaveBeenCalledTimes(1);
    expect(toast.loading.mock.calls[0]?.[0]).toBe(
      'common:uploads.uploadingProgress {"current":1,"total":3}',
    );
    expect(toast.update).toHaveBeenLastCalledWith("toast-1", {
      title: 'common:uploads.uploadingProgress {"current":3,"total":3}',
      description: "c.txt",
    });
    expect(toast.dismiss).toHaveBeenCalledWith("toast-1");
    expect(toast.success).toHaveBeenCalledWith(
      'tasks:attachments.toast.attached {"count":3}',
    );
  });

  it("keeps going past one failure and reports it", async () => {
    const upload = vi
      .fn()
      .mockRejectedValueOnce(
        new HttpError(400, "Upload exceeds the maximum upload size of 10MB."),
      )
      .mockResolvedValueOnce("ok");
    const results = await uploadFilesWithProgress({
      files: [file("big.pdf"), file("small.txt")],
      t,
      upload,
    });
    expect(results).toEqual(["ok"]);
    expect(toast.error).toHaveBeenCalledWith(
      'common:uploads.tooLarge {"filename":"big.pdf","limit":"10 MB"}',
    );
  });

  it("stops the batch when the server has no storage", async () => {
    const upload = vi.fn().mockRejectedValue(new HttpError(503, "Off"));
    await uploadFilesWithProgress({
      files: [file("a"), file("b")],
      t,
      upload,
    });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("cancels the transfer and skips the rest", async () => {
    let signal: AbortSignal | undefined;
    const upload = vi.fn(
      (_picked: File, given: AbortSignal) =>
        new Promise<string>((_resolve, reject) => {
          signal = given;
          given.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    const done = uploadFilesWithProgress({
      files: [file("a"), file("b")],
      t,
      upload,
    });
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    toast.loading.mock.calls[0]?.[1]?.cancel?.onClick?.();
    expect(signal?.aborted).toBe(true);
    await expect(done).resolves.toEqual([]);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith("common:uploads.cancelled");
  });

  it("skips empty files and takes at most the batch limit", async () => {
    const upload = vi.fn(async (picked: File) => picked.name);
    const files = [
      file("empty", ""),
      ...Array.from({ length: MAX_FILES_PER_UPLOAD + 2 }, (_, index) =>
        file(`f${index}`),
      ),
    ];
    await uploadFilesWithProgress({ files, t, upload });
    expect(toast.error).toHaveBeenCalledWith(
      'tasks:attachments.toast.empty {"filename":"empty"}',
    );
    expect(toast.warning).toHaveBeenCalledWith(
      `tasks:attachments.toast.tooMany {"count":${MAX_FILES_PER_UPLOAD}}`,
    );
    // The empty file was one of the first ten.
    expect(upload).toHaveBeenCalledTimes(MAX_FILES_PER_UPLOAD - 1);
  });

  it("stops quietly when the caller has nowhere left to put files", async () => {
    const upload = vi.fn(async (picked: File) => picked.name);
    await uploadFilesWithProgress({
      files: [file("a"), file("b")],
      t,
      upload,
      onUploaded: () => false,
    });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.dismiss).toHaveBeenCalled();
  });
});
