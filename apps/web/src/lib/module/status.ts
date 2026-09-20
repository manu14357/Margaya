import type { LucideIcon } from "lucide-react";
import {
  Circle,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CirclePause,
  CircleX,
} from "lucide-react";
import type { ModuleStatus } from "@/types/module";

/** The status set, in the list's grouping order. */
export const MODULE_STATUS_ORDER = [
  "backlog",
  "planned",
  "in-progress",
  "paused",
  "completed",
  "cancelled",
] as const satisfies readonly ModuleStatus[];

type ModuleStatusMeta = {
  icon: LucideIcon;
  iconClassName: string;
  labelKey: `modules:status.${ModuleStatus}`;
};

export const MODULE_STATUS_META: Record<ModuleStatus, ModuleStatusMeta> = {
  backlog: {
    icon: CircleDashed,
    iconClassName: "text-muted-foreground",
    labelKey: "modules:status.backlog",
  },
  planned: {
    icon: Circle,
    iconClassName: "text-info-foreground",
    labelKey: "modules:status.planned",
  },
  "in-progress": {
    icon: CircleDot,
    iconClassName: "text-warning-foreground",
    labelKey: "modules:status.in-progress",
  },
  paused: {
    icon: CirclePause,
    iconClassName: "text-muted-foreground",
    labelKey: "modules:status.paused",
  },
  completed: {
    icon: CircleCheck,
    iconClassName: "text-success-foreground",
    labelKey: "modules:status.completed",
  },
  cancelled: {
    icon: CircleX,
    iconClassName: "text-destructive-foreground",
    labelKey: "modules:status.cancelled",
  },
};

export function isModuleStatus(value: unknown): value is ModuleStatus {
  return (
    typeof value === "string" &&
    (MODULE_STATUS_ORDER as readonly string[]).includes(value)
  );
}

type ModuleStateLike = { status: ModuleStatus; archivedAt: string | null };

/** Archived modules are read-only until restored. */
export function canEditModule(module: Pick<ModuleStateLike, "archivedAt">) {
  return !module.archivedAt;
}

/** Only completed or cancelled modules can be archived. */
export function canArchiveModule(module: ModuleStateLike): boolean {
  return (
    !module.archivedAt &&
    (module.status === "completed" || module.status === "cancelled")
  );
}

/**
 * Delete is offered to callers with module:delete, and to a module's creator
 * who can update modules (the API's rule). Archived modules can be deleted.
 */
export function canDeleteModule(
  module: { createdBy: string | null },
  {
    canDeleteModules,
    canUpdateModules,
    userId,
  }: { canDeleteModules: boolean; canUpdateModules: boolean; userId?: string },
): boolean {
  if (canDeleteModules) return true;
  return Boolean(
    canUpdateModules &&
      userId &&
      module.createdBy &&
      module.createdBy === userId,
  );
}
