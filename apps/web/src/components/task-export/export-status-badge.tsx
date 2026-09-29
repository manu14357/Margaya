import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { TaskExportStatus } from "@/types/task-export";

const VARIANTS = {
  queued: "outline",
  processing: "info",
  completed: "success",
  failed: "error",
  expired: "secondary",
} as const satisfies Record<TaskExportStatus, string>;

const LABEL_KEYS = {
  queued: "settings:workspaceExports.status.queued",
  processing: "settings:workspaceExports.status.processing",
  completed: "settings:workspaceExports.status.completed",
  failed: "settings:workspaceExports.status.failed",
  expired: "settings:workspaceExports.status.expired",
} as const satisfies Record<TaskExportStatus, string>;

type ExportStatusBadgeProps = {
  status: TaskExportStatus;
  /** A failed export's reason, shown in a tooltip. */
  error?: string | null;
};

export function ExportStatusBadge({ status, error }: ExportStatusBadgeProps) {
  const { t } = useTranslation();
  const badge = (
    <Badge variant={VARIANTS[status]}>
      {status === "processing" && <Spinner className="size-3" />}
      {t(LABEL_KEYS[status])}
    </Badge>
  );

  if (status !== "failed" || !error) return badge;

  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex cursor-default" />}>
        {badge}
        <span className="sr-only">{error}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72">{error}</TooltipContent>
    </Tooltip>
  );
}

export default ExportStatusBadge;
