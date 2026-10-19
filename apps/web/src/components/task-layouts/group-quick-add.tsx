import QuickAdd from "@/components/task-draft/quick-add";
import {
  type CaptureCapabilities,
  type CaptureGrouping,
  captureTargetFor,
} from "@/lib/task-query/capture-target";
import type { TaskQueryMeta } from "@/types/task-query";
import { useGroupPresentation } from "./group-label";

/** What a list or board needs to offer a quick add in its groups. */
export type QuickAddContext = {
  /** The list's own project; null on cross-project lists. */
  scopeProjectId: string | null;
  can: CaptureCapabilities;
  onCreated?: (task: { id: string; projectId: string }) => void;
};

/**
 * The quick add at the foot of a group (or a board cell): the new task takes
 * the group's values. Renders nothing where a new task couldn't belong.
 */
export default function GroupQuickAdd({
  context,
  groupings,
  meta,
  workspaceId,
  className,
}: {
  context: QuickAddContext;
  groupings: readonly CaptureGrouping[];
  meta: TaskQueryMeta;
  workspaceId: string;
  className?: string;
}) {
  const present = useGroupPresentation();
  const { scopeProjectId, can } = context;
  const target = captureTargetFor({ groupings, meta, scopeProjectId, can });
  if (!target) return null;

  const names = groupings
    .filter((grouping) => grouping.by)
    .map((grouping) => present(grouping.by, grouping.key, meta).label);
  const { projectId, statusName, ...prefill } = target;

  return (
    <QuickAdd
      projectId={projectId}
      workspaceId={workspaceId}
      prefill={{
        ...prefill,
        targetName: names.length > 0 ? names.join(" · ") : statusName,
      }}
      onCreated={context.onCreated}
      className={className}
    />
  );
}
