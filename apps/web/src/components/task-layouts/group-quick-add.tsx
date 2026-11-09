import QuickAdd from "@/components/task-draft/quick-add";
import type { Capability } from "@/hooks/use-workspace-permission";
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
  /**
   * The capability in one project (useWorkspacePermission): a group of a
   * cross-project list adds only where its project role allows it.
   */
  canInProject?: (projectId: string, capability: Capability) => boolean;
  onCreated?: (task: { id: string; projectId: string }) => void;
};

/** What a new task may take from its group, in the group's own project. */
function cappedTo(
  { can, canInProject }: QuickAddContext,
  projectId: string | null,
): CaptureCapabilities {
  if (!canInProject || !projectId) return can;
  return {
    updateCycles: can.updateCycles && canInProject(projectId, "updateCycles"),
    updateModules:
      can.updateModules && canInProject(projectId, "updateModules"),
    updateTasks: can.updateTasks && canInProject(projectId, "updateTasks"),
  };
}

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
  const { scopeProjectId, can, canInProject } = context;
  const groupProject =
    captureTargetFor({ groupings, meta, scopeProjectId, can })?.projectId ??
    null;
  const target = captureTargetFor({
    groupings,
    meta,
    scopeProjectId,
    can: cappedTo(context, groupProject),
  });
  if (!target) return null;
  if (canInProject && !canInProject(target.projectId, "createTasks")) {
    return null;
  }

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
