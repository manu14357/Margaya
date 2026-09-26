import type { Editor } from "@tiptap/core";
import type { DragEvent } from "react";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "@/lib/toast";

export type EditorRange = { from: number; to: number };

export type UploadedEditorAsset = {
  url: string;
  alt: string;
  filename: string;
  kind: "image" | "attachment";
  mimeType: string;
  size: number;
};

type Options = {
  /** Uploads one file and answers where it is stored. */
  upload: (file: File) => Promise<UploadedEditorAsset>;
  /** Read at call time: uploads are refused while it is false. */
  canUpload: () => boolean;
  /** An id of what the editor shows; an answer for another one is dropped. */
  scopeId: string;
};

/** Inserts an uploaded image as an image, anything else as a file card. */
export function insertUploadedAsset(
  editor: Editor,
  asset: UploadedEditorAsset,
  range?: EditorRange,
) {
  const chain = editor.chain().focus();
  if (range) {
    chain.deleteRange(range);
  } else if (!editor.state.selection.empty) {
    chain.setTextSelection(editor.state.selection.to);
  }
  if (asset.kind === "image") {
    chain.setImage({ src: asset.url, alt: asset.alt }).run();
    return;
  }
  chain
    .insertContent({
      type: "attachmentCard",
      attrs: {
        url: asset.url,
        filename: asset.filename,
        mimeType: asset.mimeType,
        size: asset.size,
      },
    })
    .run();
}

function hasFileDrag(event: DragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer?.items || []).some(
    (item) => item.kind === "file",
  );
}

/**
 * Upload, paste and drop of images and files into an editor: a hidden file
 * input, the drag-over state of the editor shell, and the upload itself
 * (toasts included), parameterized by where files are stored.
 */
export function useEditorAssetUpload({ upload, canUpload, scopeId }: Options) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);
  const scopeRef = useRef(scopeId);
  scopeRef.current = scopeId;
  const uploadRef = useRef(upload);
  uploadRef.current = upload;
  const canUploadRef = useRef(canUpload);
  canUploadRef.current = canUpload;
  const pendingInsertRef = useRef<{
    editor: Editor;
    range?: EditorRange;
    scopeId: string;
  } | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);

  const uploadFile = useCallback(
    async (file: File, editor: Editor | null, range?: EditorRange) => {
      if (!canUploadRef.current() || !editor) return;
      const scope = scopeRef.current;
      const loadingToast = toast.loading(
        t("tasks:detail.editor.upload.loading"),
      );
      try {
        const asset = await uploadRef.current(file);
        toast.dismiss(loadingToast);
        if (editor.isDestroyed || scopeRef.current !== scope) return;
        insertUploadedAsset(editor, asset, range);
        toast.success(
          asset.kind === "image"
            ? t("tasks:detail.editor.upload.imageSuccess")
            : t("tasks:detail.editor.upload.fileSuccess"),
        );
      } catch (error) {
        toast.dismiss(loadingToast);
        toast.error(
          error instanceof Error && error.message
            ? error.message
            : t("tasks:detail.editor.upload.failed"),
        );
      }
    },
    [t],
  );

  const openFilePicker = useCallback(
    (editor: Editor | null, range?: EditorRange) => {
      if (!canUploadRef.current() || !editor) return;
      pendingInsertRef.current = { editor, range, scopeId: scopeRef.current };
      fileInputRef.current?.click();
    },
    [],
  );

  const onFileInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      const pending = pendingInsertRef.current;
      pendingInsertRef.current = null;
      if (!file || !pending || pending.scopeId !== scopeRef.current) return;
      void uploadFile(file, pending.editor, pending.range);
    },
    [uploadFile],
  );

  const shellDragHandlers = {
    onDragEnter: (event: DragEvent<HTMLElement>) => {
      if (!canUploadRef.current() || !hasFileDrag(event)) return;
      event.preventDefault();
      dragDepthRef.current += 1;
      setIsDragActive(true);
    },
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!canUploadRef.current() || !hasFileDrag(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setIsDragActive(true);
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (!canUploadRef.current() || !hasFileDrag(event)) return;
      event.preventDefault();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setIsDragActive(false);
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      if (!hasFileDrag(event)) return;
      dragDepthRef.current = 0;
      setIsDragActive(false);
    },
  };

  return {
    fileInputRef,
    onFileInputChange,
    uploadFile,
    openFilePicker,
    isDragActive,
    shellDragHandlers,
  };
}
