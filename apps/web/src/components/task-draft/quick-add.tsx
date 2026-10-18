import { Plus } from "lucide-react";
import { type ComponentProps, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import CaptureBar, { type CapturePrefill } from "./capture-bar";

type QuickAddProps = {
  projectId: string;
  workspaceId: string;
  prefill: CapturePrefill;
  className?: string;
  onCreated?: ComponentProps<typeof CaptureBar>["onCreated"];
};

/**
 * A group's quick add: a light "+ Add task" row that becomes the capture
 * bar on click or focus. Big boards hold many groups, so the bar (and its
 * people and label lookups) mounts only where someone starts typing; once
 * opened it stays, so a handoff to the composer survives a blur.
 */
export default function QuickAdd({
  projectId,
  workspaceId,
  prefill,
  className,
  onCreated,
}: QuickAddProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  if (open) {
    return (
      <CaptureBar
        projectId={projectId}
        workspaceId={workspaceId}
        prefill={prefill}
        className={className}
        onCreated={onCreated}
        autoFocus
      />
    );
  }

  return (
    <button
      type="button"
      data-quick-add
      aria-label={t("tasks:capture.ariaLabel", { column: prefill.targetName })}
      onClick={() => setOpen(true)}
      onFocus={() => setOpen(true)}
      className={cn(
        "flex h-8 w-full items-center gap-1.5 rounded-md border border-transparent ps-2 pe-1 text-left text-muted-foreground text-sm transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <Plus aria-hidden className="size-3.5 shrink-0" />
      <span className="truncate">{t("tasks:capture.placeholder")}</span>
    </button>
  );
}
