import { CircleCheck, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import CircularProgress from "@/components/ui/circular-progress";
import { cn } from "@/lib/cn";
import { moduleDateRangeText } from "@/lib/module/dates";
import type { Module } from "@/types/module";
import { PersonAvatar } from "./module-people";
import { ModuleStatusLabel } from "./module-status";
import { ModuleStatusPopover } from "./module-status-popover";

// Small pieces the modules list, gallery and module page share.

/** "Mar 3 – Apr 16, 2026", "Starts …", "Due …" or "No dates". */
export function useModuleDateText() {
  const { t } = useTranslation();
  return (startDate: string | null, targetDate: string | null) => {
    const text = moduleDateRangeText(startDate, targetDate);
    switch (text.key) {
      case "modules:row.dateRange":
        return t(text.key, { start: text.start, end: text.end });
      case "modules:row.startsOn":
      case "modules:row.dueOn":
        return t(text.key, { date: text.date });
      default:
        return t(text.key);
    }
  };
}

/** The progress ring and percent; a check once everything is done. */
export function ModuleProgressRing({
  module,
}: {
  module: Pick<Module, "progress" | "counts">;
}) {
  const { t } = useTranslation();
  const done = module.progress === 100 && module.counts.total > 0;
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs tabular-nums">
      {done ? (
        <CircleCheck aria-hidden className="size-4 text-success-foreground" />
      ) : (
        <CircularProgress completed={module.progress} total={100} />
      )}
      <span aria-hidden className="w-8">
        {module.progress}%
      </span>
      <span className="sr-only">
        {t("modules:row.progressLabel", { percent: module.progress })}
      </span>
    </span>
  );
}

/** The status as a chip that edits it in place when allowed. */
export function ModuleStatusChip({
  module,
  className,
}: {
  module: Pick<Module, "id" | "projectId" | "status" | "archivedAt">;
  className?: string;
}) {
  return (
    <ModuleStatusPopover module={module}>
      <button
        type="button"
        className={cn(
          "inline-flex h-6 max-w-36 items-center rounded-md border border-border bg-background px-2 text-xs transition-colors hover:bg-accent/60",
          className,
        )}
      >
        <ModuleStatusLabel status={module.status} />
      </button>
    </ModuleStatusPopover>
  );
}

/** The lead's avatar, or a dashed placeholder meaning "No lead". */
export function ModuleLeadAvatar({ lead }: { lead: Module["lead"] }) {
  const { t } = useTranslation();
  if (!lead) {
    return (
      <span
        role="img"
        aria-label={t("modules:row.noLead")}
        title={t("modules:row.noLead")}
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-border border-dashed text-muted-foreground"
      >
        <UserRound className="size-3" />
      </span>
    );
  }
  return (
    <span title={t("modules:row.lead", { name: lead.name })}>
      <PersonAvatar person={lead} />
    </span>
  );
}
