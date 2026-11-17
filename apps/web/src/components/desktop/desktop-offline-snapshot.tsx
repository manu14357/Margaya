import { useEffect, useMemo, useRef } from "react";
import type getPage from "@/fetchers/page/get-page";
import type getTask from "@/fetchers/task/get-task";
import { useGetColumns } from "@/hooks/queries/column/use-get-columns";
import useGetProject from "@/hooks/queries/project/use-get-project";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { getDesktopOfflineSnapshotSaver } from "@/lib/desktop";
import {
  buildOfflineSnapshot,
  createOfflineSnapshotSender,
  type DesktopOfflineSnapshot,
} from "@/lib/desktop-offline-snapshot";
import { getPriorityLabel, getStatusDisplayLabel } from "@/lib/i18n/domain";

type Task = Awaited<ReturnType<typeof getTask>>;
type Page = Awaited<ReturnType<typeof getPage>>;

/** Debounced sends of the latest snapshot while this item stays on screen. */
function useSendOfflineSnapshot(snapshot: DesktopOfflineSnapshot | null) {
  const sender = useRef<ReturnType<typeof createOfflineSnapshotSender> | null>(
    null,
  );
  useEffect(() => {
    const created = createOfflineSnapshotSender();
    sender.current = created;
    return () => {
      created.cancel();
      sender.current = null;
    };
  }, []);
  useEffect(() => {
    sender.current?.push(snapshot);
  }, [snapshot]);
}

function TaskSnapshot({
  task,
  workspaceId,
}: {
  task: Task;
  workspaceId: string;
}) {
  const { data: project } = useGetProject({ id: task.projectId, workspaceId });
  const { data: columns } = useGetColumns(task.projectId);
  const { data: workspace } = useActiveWorkspace();
  const projectName = project?.name;
  const workspaceName = workspace?.name;
  const snapshot = useMemo(() => {
    const column = columns?.find(
      (candidate) =>
        candidate.slug === task.status || candidate.id === task.status,
    );
    return buildOfflineSnapshot({
      kind: "task",
      id: task.id,
      path: `/dashboard/workspace/${workspaceId}/project/${task.projectId}/task/${task.id}`,
      title: task.title,
      workspaceName,
      projectName,
      status: task.status
        ? getStatusDisplayLabel(task.status, column?.name)
        : null,
      priority:
        task.priority && task.priority !== "no-priority"
          ? getPriorityLabel(task.priority)
          : null,
      dueDate: task.dueDate,
      assignees: task.assignees?.map((assignee) => assignee.name),
      markdown: task.description,
    });
  }, [task, columns, projectName, workspaceName, workspaceId]);
  useSendOfflineSnapshot(snapshot);
  return null;
}

function PageSnapshot({
  page,
  workspaceId,
}: {
  page: Page;
  workspaceId: string;
}) {
  const projectId = page.projectId ?? "";
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const { data: workspace } = useActiveWorkspace();
  const projectName = project?.name;
  const workspaceName = workspace?.name;
  const snapshot = useMemo(
    () =>
      projectId
        ? buildOfflineSnapshot({
            kind: "page",
            id: page.id,
            path: `/dashboard/workspace/${workspaceId}/project/${projectId}/pages/${page.id}`,
            title: page.title,
            workspaceName,
            projectName,
            markdown: page.contentMarkdown,
            updatedAt: page.updatedAt,
          })
        : null,
    [page, projectId, projectName, workspaceName, workspaceId],
  );
  useSendOfflineSnapshot(snapshot);
  return null;
}

/**
 * In the desktop app, keeps a read-only copy of the open task for the app's
 * offline page. Renders nothing; does nothing in a browser.
 */
export function DesktopTaskOfflineSnapshot({
  task,
  workspaceId,
}: {
  task: Task | undefined;
  workspaceId: string;
}) {
  if (!task || !getDesktopOfflineSnapshotSaver()) return null;
  return <TaskSnapshot key={task.id} task={task} workspaceId={workspaceId} />;
}

/** The same for the open page. */
export function DesktopPageOfflineSnapshot({
  page,
  workspaceId,
}: {
  page: Page | undefined;
  workspaceId: string;
}) {
  if (!page || !getDesktopOfflineSnapshotSaver()) return null;
  return <PageSnapshot key={page.id} page={page} workspaceId={workspaceId} />;
}
