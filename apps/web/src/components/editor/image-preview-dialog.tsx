import type { Editor } from "@tiptap/core";
import { useEffect, useRef } from "react";
import { useFilePreview } from "@/components/file-preview/file-preview-dialog";
import { IMAGE_PREVIEW_EVENT, type ImagePreview } from "@/lib/editor-image";
import { collectEditorFiles, resolveFileUrl } from "@/lib/file-preview";

function imageTarget(target: EventTarget | null): HTMLImageElement | null {
  return target instanceof HTMLImageElement &&
    target.classList.contains("margaya-editor-image")
    ? target
    : null;
}

/**
 * The full-screen preview of an editor's images and files: a click on an
 * image opens it in read-only views, a double click while editing, and so
 * does the image toolbar's full-screen button. Its arrows step through
 * every image and file card of the editor, in document order.
 */
export function useImagePreview(editor: Editor | null, fallbackAlt: string) {
  const preview = useFilePreview();
  const openRef = useRef(preview.open);
  openRef.current = preview.open;
  const fallbackRef = useRef(fallbackAlt);
  fallbackRef.current = fallbackAlt;

  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const show = (image: Element | null, request?: ImagePreview) => {
      const { files, index } = collectEditorFiles(
        dom,
        image,
        fallbackRef.current,
      );
      if (image && files.length > 0) {
        openRef.current(files, index);
        return;
      }
      const url = resolveFileUrl(request?.src);
      if (url) {
        openRef.current([
          {
            url,
            name: request?.alt || fallbackRef.current,
            kind: "image",
          },
        ]);
      }
    };
    const onClick = (event: MouseEvent) => {
      const image = imageTarget(event.target);
      if (!image || editor.isEditable) return;
      event.preventDefault();
      show(image);
    };
    const onDoubleClick = (event: MouseEvent) => {
      const image = imageTarget(event.target);
      if (!image || !editor.isEditable) return;
      event.preventDefault();
      show(image);
    };
    const onRequest = (event: Event) => {
      const request = (event as CustomEvent<ImagePreview>).detail;
      if (!request?.src) return;
      const holder = event.target instanceof Element ? event.target : null;
      const image =
        holder?.querySelector("img.margaya-editor-image") ??
        imageTarget(holder);
      show(image ?? null, request);
    };
    dom.addEventListener("click", onClick);
    dom.addEventListener("dblclick", onDoubleClick);
    dom.addEventListener(IMAGE_PREVIEW_EVENT, onRequest);
    return () => {
      dom.removeEventListener("click", onClick);
      dom.removeEventListener("dblclick", onDoubleClick);
      dom.removeEventListener(IMAGE_PREVIEW_EVENT, onRequest);
    };
  }, [editor]);

  return { dialog: preview.dialog };
}
