import type { Editor } from "@tiptap/core";
import { Download, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogPopup } from "@/components/ui/dialog";
import {
  downloadImage,
  IMAGE_PREVIEW_EVENT,
  type ImagePreview,
} from "@/lib/editor-image";

function imageTarget(target: EventTarget | null): HTMLImageElement | null {
  return target instanceof HTMLImageElement &&
    target.classList.contains("margaya-editor-image")
    ? target
    : null;
}

/**
 * The full-screen image preview of an editor: a click on an image opens it
 * in read-only views, a double click while editing, and so does the image
 * toolbar's full-screen button.
 */
export function useImagePreview(editor: Editor | null, fallbackAlt: string) {
  const [preview, setPreview] = useState<ImagePreview | null>(null);
  const fallbackRef = useRef(fallbackAlt);
  fallbackRef.current = fallbackAlt;

  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const open = (image: HTMLImageElement, event: Event) => {
      event.preventDefault();
      setPreview({
        src: image.currentSrc || image.src,
        alt: image.alt || fallbackRef.current,
      });
    };
    const onClick = (event: MouseEvent) => {
      const image = imageTarget(event.target);
      if (image && !editor.isEditable) open(image, event);
    };
    const onDoubleClick = (event: MouseEvent) => {
      const image = imageTarget(event.target);
      if (image && editor.isEditable) open(image, event);
    };
    const onRequest = (event: Event) => {
      const { src, alt } = (event as CustomEvent<ImagePreview>).detail;
      if (src) setPreview({ src, alt: alt || fallbackRef.current });
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

  return {
    preview,
    dialog: (
      <ImagePreviewDialog preview={preview} onClose={() => setPreview(null)} />
    ),
  };
}

export function ImagePreviewDialog({
  preview,
  onClose,
}: {
  preview: ImagePreview | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={Boolean(preview)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup
        className="max-w-6xl border-0 bg-transparent p-0 shadow-none before:hidden"
        showCloseButton={false}
        bottomStickOnMobile={false}
      >
        {preview && (
          <div className="flex max-h-[90vh] flex-col items-center justify-center gap-2 p-4">
            <div className="flex gap-1 self-end">
              <Button
                type="button"
                variant="secondary"
                size="icon-sm"
                aria-label={t("tasks:detail.editor.image.download")}
                title={t("tasks:detail.editor.image.download")}
                onClick={() => downloadImage(preview.src, preview.alt)}
              >
                <Download />
              </Button>
              <DialogClose
                render={
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon-sm"
                    aria-label={t("tasks:detail.editor.image.closePreview")}
                    title={t("tasks:detail.editor.image.closePreview")}
                  />
                }
              >
                <X />
              </DialogClose>
            </div>
            <img
              src={preview.src}
              alt={preview.alt}
              className="max-h-[80vh] max-w-[92vw] rounded-xl border border-white/12 bg-black/30 object-contain shadow-2xl"
            />
          </div>
        )}
      </DialogPopup>
    </Dialog>
  );
}
