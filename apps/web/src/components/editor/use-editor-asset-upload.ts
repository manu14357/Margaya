import type { Editor } from "@tiptap/core";
import type { DragEvent } from "react";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { uploadFilesWithProgress } from "@/lib/upload-files";

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
  upload: (file: File, signal: AbortSignal) => Promise<UploadedEditorAsset>;
  /** Read at call time: uploads are refused while it is false. */
  canUpload: () => boolean;
  /** An id of what the editor shows; an answer for another one is dropped. */
  scopeId: string;
  /** The editor a drop on the shell around the text goes to. */
  getEditor: () => Editor | null;
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
export function useEditorAssetUpload({
  upload,
  canUpload,
  scopeId,
  getEditor,
}: Options) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);
  const scopeRef = useRef(scopeId);
  scopeRef.current = scopeId;
  const uploadRef = useRef(upload);
  uploadRef.current = upload;
  const canUploadRef = useRef(canUpload);
  canUploadRef.current = canUpload;
  const getEditorRef = useRef(getEditor);
  getEditorRef.current = getEditor;
  const pendingInsertRef = useRef<{
    editor: Editor;
    range?: EditorRange;
    scopeId: string;
  } | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);

  const uploadFiles = useCallback(
    async (files: File[], editor: Editor | null, range?: EditorRange) => {
      if (!canUploadRef.current() || !editor || files.length === 0) return;
      const scope = scopeRef.current;
      // The first file lands where it was dropped; each next one follows it.
      let insertAt = range;
      await uploadFilesWithProgress({
        files,
        t,
        upload: (file, signal) => uploadRef.current(file, signal),
        onUploaded: (asset) => {
          if (editor.isDestroyed || scopeRef.current !== scope) return false;
          insertUploadedAsset(editor, asset, insertAt);
          insertAt = undefined;
          return undefined;
        },
        successMessage: (assets) =>
          assets.length > 1
            ? t("tasks:attachments.toast.attached", { count: assets.length })
            : assets[0]?.kind === "image"
              ? t("tasks:detail.editor.upload.imageSuccess")
              : t("tasks:detail.editor.upload.fileSuccess"),
      });
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
      const files = Array.from(event.target.files ?? []);
      // Picking the same file again must fire change again.
      event.target.value = "";
      const pending = pendingInsertRef.current;
      pendingInsertRef.current = null;
      if (files.length === 0 || !pending) return;
      if (pending.scopeId !== scopeRef.current) return;
      void uploadFiles(files, pending.editor, pending.range);
    },
    [uploadFiles],
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
      // The text area took it already; a drop on the shell around it (the
      // padding, the attach button) is still meant for this editor.
      if (!canUploadRef.current() || event.nativeEvent.defaultPrevented) return;
      event.preventDefault();
      void uploadFiles(
        Array.from(event.dataTransfer.files),
        getEditorRef.current(),
      );
    },
  };

  return {
    fileInputRef,
    onFileInputChange,
    uploadFiles,
    openFilePicker,
    isDragActive,
    shellDragHandlers,
  };
}
