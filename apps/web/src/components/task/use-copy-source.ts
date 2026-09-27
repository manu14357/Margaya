import { isProjectFeatureEnabled } from "@/constants/project-features";
import useGetCustomFieldValuesByTask from "@/hooks/queries/custom-field/use-get-custom-field-values-by-task";
import useGetLabelsByTask from "@/hooks/queries/label/use-get-labels-by-task";
import useGetTaskModules from "@/hooks/queries/module/use-get-task-modules";
import useGetProject from "@/hooks/queries/project/use-get-project";
import useGetTask from "@/hooks/queries/task/use-get-task";
import useGetTaskAttachments from "@/hooks/queries/task-attachment/use-get-task-attachments";
import useGetTaskLinks from "@/hooks/queries/task-link/use-get-task-links";
import useGetTaskRelations from "@/hooks/queries/task-relation/use-get-task-relations";
import type { CopySourceData } from "@/lib/copy-task-options";
import { oldestParent } from "@/lib/task-relations";
import type { CopyTaskTarget } from "@/store/copy-task-dialog";

/**
 * What the task to copy has, per "Make a copy" option, so the dialog lists
 * only options with something to copy. `ready` turns true once every part
 * has answered (failed parts count as empty).
 */
export function useCopySource({
  taskId,
  projectId,
  workspaceId,
}: CopyTaskTarget) {
  const task = useGetTask(taskId);
  const sourceProjectId = task.data?.projectId ?? projectId;
  const project = useGetProject({ id: sourceProjectId, workspaceId });
  const labels = useGetLabelsByTask(taskId);
  const fieldValues = useGetCustomFieldValuesByTask(taskId);
  const relations = useGetTaskRelations(taskId);
  const cyclesOn = isProjectFeatureEnabled(project.data, "cycles");
  const modulesOn = isProjectFeatureEnabled(project.data, "modules");
  const estimatesOn = isProjectFeatureEnabled(project.data, "estimates");
  const modules = useGetTaskModules(sourceProjectId, taskId, {
    enabled: modulesOn,
  });
  const links = useGetTaskLinks(taskId);
  const attachments = useGetTaskAttachments(taskId);

  const source = task.data;
  const parent = oldestParent(relations.data ?? [], taskId);
  const sourceHas: CopySourceData = {
    description: Boolean(source?.description?.trim()),
    assignees:
      (source?.assigneeIds?.length ?? 0) > 0 || Boolean(source?.userId),
    labels: (labels.data?.length ?? 0) > 0,
    dates: Boolean(source?.startDate || source?.dueDate),
    customFields: (fieldValues.data ?? []).some(
      (field) => field.value != null && field.value !== "",
    ),
    parent: Boolean(parent),
    planning:
      (cyclesOn && Boolean(source?.cycleId)) ||
      (modulesOn && (modules.data?.length ?? 0) > 0) ||
      (estimatesOn && Boolean(source?.estimatePointId)),
    links: (links.data?.length ?? 0) > 0,
    attachments: (attachments.data?.length ?? 0) > 0,
  };

  const ready =
    Boolean(source) &&
    ![
      project,
      labels,
      fieldValues,
      relations,
      modules,
      links,
      attachments,
    ].some((query) => query.isLoading);

  return {
    task: source,
    project: project.data,
    sourceProjectId,
    parentTaskId: parent?.sourceTaskId ?? null,
    sourceHas,
    ready,
  };
}
