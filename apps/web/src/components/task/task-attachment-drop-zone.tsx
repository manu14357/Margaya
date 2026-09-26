import { type ReactNode, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";

type TaskAttachmentDropZoneProps = {
  /** Without task:update the zone is inert. */
  disabled?: boolean;
  onFiles: (files: File[]) => void;
  className?: string;
  /** The overlay's text; the compact button variant hides it. */
  showLabel?: boolean;
  children: ReactNode;
};

function carriesFiles(event: React.DragEvent) {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

/**
 * Accepts files dragged onto its children and shows a dashed overlay while
 * they hover. Drags that carry no files (text, links, cards) are ignored.
 */
export default function TaskAttachmentDropZone({
  disabled = false,
  onFiles,
  className,
  showLabel = true,
  children,
}: TaskAttachmentDropZoneProps) {
  const { t } = useTranslation();
  const [isOver, setIsOver] = useState(false);
  // dragenter/dragleave fire for every child; count them to know when the
  // pointer really left the zone.
  const depth = useRef(0);

  if (disabled) return <div className={className}>{children}</div>;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a drop target; the picker buttons inside are the keyboard path
    <div
      className={cn("relative", className)}
      onDragEnter={(event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        depth.current += 1;
        setIsOver(true);
      }}
      onDragOver={(event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (!carriesFiles(event)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setIsOver(false);
      }}
      onDrop={(event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        event.stopPropagation();
        depth.current = 0;
        setIsOver(false);
        const files = Array.from(event.dataTransfer.files ?? []);
        if (files.length > 0) onFiles(files);
      }}
    >
      {children}
      {isOver && (
        <div
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-md border-2 border-primary border-dashed bg-background/85 font-medium text-primary text-xs"
          data-testid="attachment-drop-overlay"
        >
          {showLabel ? t("tasks:attachments.dropToAttach") : null}
        </div>
      )}
    </div>
  );
}
