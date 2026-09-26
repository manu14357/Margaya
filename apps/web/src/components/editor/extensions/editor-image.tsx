import {
  IMAGE_MAX_WIDTH,
  IMAGE_MIN_WIDTH,
  type ImageAlign,
  imageAlign,
  imageWidth,
  MargayaImage,
} from "@margaya/editor-schema";
import type { NodeViewProps } from "@tiptap/react";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Download,
  Expand,
  type LucideIcon,
  Undo2,
} from "lucide-react";
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { downloadImage, requestImagePreview } from "@/lib/editor-image";

const WIDTH_STEP = 5;

function clampWidth(value: number): number {
  return Math.min(
    IMAGE_MAX_WIDTH,
    Math.max(IMAGE_MIN_WIDTH, Math.round(value)),
  );
}

type ToolbarButton = {
  key: string;
  Icon: LucideIcon;
  label: string;
  active?: boolean;
  onClick: () => void;
};

/**
 * An image at its stored width (a percentage of the text column) and
 * alignment. While editing, the selected image shows resize handles and a
 * toolbar: alignment, original size, full screen and download.
 */
function ImageView({
  node,
  editor,
  getPos,
  selected,
  updateAttributes,
}: NodeViewProps) {
  const { t } = useTranslation();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLSpanElement | null>(null);
  const [draftWidth, setDraftWidth] = useState<number | null>(null);
  const src = String(node.attrs.src ?? "");
  const alt = String(node.attrs.alt ?? "");
  const title = node.attrs.title ? String(node.attrs.title) : undefined;
  const width = imageWidth(node.attrs.width);
  const align = imageAlign(node.attrs.align);
  const shownWidth = draftWidth ?? width;
  const editing = editor.isEditable && selected;

  // Read from the document, not the render: key repeats outrun re-renders.
  const currentWidth = () => {
    const pos = getPos();
    const live =
      typeof pos === "number"
        ? imageWidth(editor.state.doc.nodeAt(pos)?.attrs.width)
        : width;
    if (live !== null) return live;
    const frame = frameRef.current?.getBoundingClientRect().width ?? 0;
    const column = wrapperRef.current?.getBoundingClientRect().width ?? 0;
    return column > 0 ? clampWidth((frame / column) * 100) : IMAGE_MAX_WIDTH;
  };

  const startResize =
    (side: "left" | "right") => (event: ReactPointerEvent<HTMLElement>) => {
      const frame = frameRef.current;
      const wrapper = wrapperRef.current;
      if (!frame || !wrapper || !editor.isEditable) return;
      event.preventDefault();
      event.stopPropagation();
      const column = wrapper.getBoundingClientRect().width;
      const startPx = frame.getBoundingClientRect().width;
      const startX = event.clientX;
      // A centred image grows on both sides at once.
      const factor = (side === "right" ? 1 : -1) * (align === "center" ? 2 : 1);
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);
      let next = currentWidth();

      const onMove = (move: PointerEvent) => {
        if (column <= 0) return;
        next = clampWidth(
          ((startPx + (move.clientX - startX) * factor) / column) * 100,
        );
        setDraftWidth(next);
      };
      const onEnd = () => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onEnd);
        handle.removeEventListener("pointercancel", onEnd);
        setDraftWidth(null);
        if (next !== width) updateAttributes({ width: next });
      };
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onEnd);
      handle.addEventListener("pointercancel", onEnd);
    };

  const onResizeKey = (event: KeyboardEvent<HTMLElement>) => {
    const step: Record<string, number> = {
      ArrowLeft: -WIDTH_STEP,
      ArrowDown: -WIDTH_STEP,
      ArrowRight: WIDTH_STEP,
      ArrowUp: WIDTH_STEP,
    };
    let next: number | null = null;
    if (event.key in step)
      next = clampWidth(currentWidth() + (step[event.key] ?? 0));
    else if (event.key === "Home") next = IMAGE_MIN_WIDTH;
    else if (event.key === "End") next = IMAGE_MAX_WIDTH;
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    updateAttributes({ width: next });
  };

  const setAlign = (value: ImageAlign) =>
    // Left is where an image sits anyway; storing nothing keeps its markdown plain.
    updateAttributes({ align: value === "left" ? null : value });

  const buttons: ToolbarButton[][] = [
    [
      {
        key: "left",
        Icon: AlignLeft,
        label: t("tasks:detail.editor.image.alignLeft"),
        active: align === null || align === "left",
        onClick: () => setAlign("left"),
      },
      {
        key: "center",
        Icon: AlignCenter,
        label: t("tasks:detail.editor.image.alignCenter"),
        active: align === "center",
        onClick: () => setAlign("center"),
      },
      {
        key: "right",
        Icon: AlignRight,
        label: t("tasks:detail.editor.image.alignRight"),
        active: align === "right",
        onClick: () => setAlign("right"),
      },
    ],
    [
      ...(width !== null
        ? [
            {
              key: "reset",
              Icon: Undo2,
              label: t("tasks:detail.editor.image.originalSize"),
              onClick: () => updateAttributes({ width: null }),
            },
          ]
        : []),
      {
        key: "preview",
        Icon: Expand,
        label: t("tasks:detail.editor.image.fullScreen"),
        onClick: () => {
          if (wrapperRef.current) {
            requestImagePreview(wrapperRef.current, { src, alt });
          }
        },
      },
      {
        key: "download",
        Icon: Download,
        label: t("tasks:detail.editor.image.download"),
        onClick: () => downloadImage(src, alt),
      },
    ],
  ];

  return (
    <NodeViewWrapper
      ref={wrapperRef}
      className={cn("margaya-image-node", editing && "is-editing")}
      data-align={align ?? undefined}
    >
      <span
        ref={frameRef}
        className="margaya-image-frame"
        style={shownWidth === null ? undefined : { width: `${shownWidth}%` }}
      >
        <img
          src={src}
          alt={alt}
          title={title}
          className="margaya-editor-image"
          loading="lazy"
          draggable={editor.isEditable}
          data-drag-handle=""
        />
        {editing && (
          <>
            {/* A pointer twin of the keyboard slider on the other side. */}
            <span
              className="margaya-image-resize is-left"
              aria-hidden="true"
              onPointerDown={startResize("left")}
            />
            <span
              role="slider"
              tabIndex={0}
              className="margaya-image-resize is-right"
              aria-label={t("tasks:detail.editor.image.resize")}
              aria-valuemin={IMAGE_MIN_WIDTH}
              aria-valuemax={IMAGE_MAX_WIDTH}
              aria-valuenow={shownWidth ?? currentWidth()}
              aria-valuetext={`${shownWidth ?? currentWidth()}%`}
              onPointerDown={startResize("right")}
              onKeyDown={onResizeKey}
            />
          </>
        )}
      </span>
      {editing && (
        <div
          className="margaya-tiptap-bubble margaya-image-toolbar"
          contentEditable={false}
          role="toolbar"
          aria-label={t("tasks:detail.editor.image.toolbar")}
        >
          {buttons.map((group, index) => (
            <span key={group[0]?.key ?? index} className="contents">
              {index > 0 && (
                <span className="margaya-tiptap-bubble-separator" />
              )}
              {group.map(({ key, Icon, label, active, onClick }) => (
                <Button
                  key={key}
                  type="button"
                  variant="ghost"
                  size="xs"
                  title={label}
                  aria-label={label}
                  aria-pressed={active}
                  className={cn(
                    "margaya-tiptap-bubble-btn",
                    active && "bg-accent text-accent-foreground",
                  )}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={onClick}
                >
                  <Icon className="size-3.5" />
                </Button>
              ))}
            </span>
          ))}
        </div>
      )}
    </NodeViewWrapper>
  );
}

/** The schema's image with the web node view. */
export const EditorImage = MargayaImage.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
});
