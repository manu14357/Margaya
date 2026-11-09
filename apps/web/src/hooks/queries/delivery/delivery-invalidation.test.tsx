import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUpdateColumn } from "@/hooks/mutations/column/use-update-column";
import {
  invalidateCycleMembership,
  invalidateCycleQueries,
} from "@/hooks/mutations/cycle/invalidate-cycle-queries";
import { useTriageIntakeItem } from "@/hooks/mutations/intake/use-triage-intake-item";
import {
  invalidateModuleMembership,
  invalidateModuleQueries,
} from "@/hooks/mutations/module/invalidate-module-queries";
import { invalidateAssigneeQueries } from "@/hooks/mutations/task/sync-task-assignees-cache";
import { invalidateAfterArchive } from "@/hooks/mutations/task/use-archive-task";
import { useBulkOperations } from "@/hooks/mutations/task/use-bulk-operations";
import useCreateTask from "@/hooks/mutations/task/use-create-task";
import { useDeleteTask } from "@/hooks/mutations/task/use-delete-task";
import useImportTasks from "@/hooks/mutations/task/use-import-tasks";
import { useMoveTask } from "@/hooks/mutations/task/use-move-task";
import { useUpdateTaskDueDate } from "@/hooks/mutations/task/use-update-task-due-date";
import { invalidateAfterStatusChange } from "@/hooks/mutations/task/use-update-task-status";
import useCopyTask from "@/hooks/mutations/task-copy/use-copy-task";
import useCreateTaskRelation from "@/hooks/mutations/task-relation/use-create-task-relation";
import useDeleteTaskRelation from "@/hooks/mutations/task-relation/use-delete-task-relation";
import { useApplyTaskTemplate } from "@/hooks/mutations/task-template/use-apply-task-template";
import { refreshAfterTaskChange } from "@/hooks/mutations/trash/use-trash-mutations";
import { cycleQueryKeys } from "@/hooks/queries/cycle/cycle-query-keys";
import { moduleQueryKeys } from "@/hooks/queries/module/module-query-keys";
import type Task from "@/types/task";
import { deliveryQueryKeys } from "./delivery-query-keys";

// The tab that makes a change gets no realtime echo of it, so its own
// mutations must mark the forecast and risks of the project stale.

const resolved = vi.hoisted(() => () => vi.fn(async () => ({})));
vi.mock("@/fetchers/task/update-task-due-date", () => ({
  default: resolved(),
}));
vi.mock("@/fetchers/task-relation/create-task-relation", () => ({
  default: resolved(),
}));
vi.mock("@/fetchers/task-relation/delete-task-relation", () => ({
  default: resolved(),
}));
vi.mock("@/fetchers/task/delete-task", () => ({
  default: vi.fn(async (id: string) => ({ id, projectId: "p1" })),
}));
vi.mock("@/fetchers/task/move-task", () => ({
  default: vi.fn(async () => ({
    sourceProjectId: "p1",
    destinationProjectId: "p2",
  })),
}));
vi.mock("@/fetchers/task/bulk-operation", () => ({ default: resolved() }));
vi.mock("@/fetchers/task/create-task", () => ({
  default: vi.fn(async () => ({ id: "t9" })),
}));
vi.mock("@/lib/task-import/batch", () => ({
  JSON_IMPORT_BATCH_SIZE: 500,
  importTasksInBatches: resolved(),
}));
vi.mock("@/fetchers/column/update-column", () => ({ default: resolved() }));
vi.mock("@/fetchers/intake/accept-intake-item", () => ({
  default: vi.fn(async () => ({
    id: "i1",
    projectId: "p1",
    taskId: "t1",
    status: "accepted",
    task: { projectId: "p1" },
  })),
}));
vi.mock("@/fetchers/task-copy/copy-task", () => ({
  default: vi.fn(async () => ({ skipped: [] })),
}));
vi.mock("@/fetchers/task-template/apply-task-template", () => ({
  default: vi.fn(async () => ({ id: "t9", subtaskIds: [] })),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

let queryClient: QueryClient;

const risks = (projectId: string) =>
  deliveryQueryKeys.risks(projectId, "cycle", "c1");

/** The project's risks, and Home's, which read every project's cycles. */
function isStale(projectId = "p1") {
  return (
    queryClient.getQueryState(risks(projectId))?.isInvalidated === true &&
    queryClient.getQueryState(deliveryQueryKeys.home("w1"))?.isInvalidated ===
      true
  );
}

function run<T>(hook: () => T) {
  return renderHook(hook, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  }).result;
}

const task = { id: "t1", projectId: "p1" } as Task;

beforeEach(() => {
  queryClient = new QueryClient();
  for (const projectId of ["p1", "p2"]) {
    queryClient.setQueryData(risks(projectId), { signals: [] });
  }
  queryClient.setQueryData(deliveryQueryKeys.home("w1"), { signals: [] });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
});

describe("what marks a project's forecast and risks stale in the acting tab", () => {
  it.each([
    ["a task's status", () => invalidateAfterStatusChange(queryClient, task)],
    [
      "a task joining a cycle",
      () => invalidateCycleMembership(queryClient, "p1", ["t1"]),
    ],
    [
      "a cycle's dates or other cycle edits",
      () => invalidateCycleQueries(queryClient, "p1", { favorites: true }),
    ],
    [
      "a module's target date or other module edits",
      () => invalidateModuleQueries(queryClient, "p1", { favorites: true }),
    ],
    [
      "tasks joining or leaving a module",
      () => invalidateModuleMembership(queryClient, "p1", ["t1"]),
    ],
    [
      "a task archived or restored",
      () => invalidateAfterArchive(queryClient, "t1", "p1"),
    ],
    [
      "a task's assignees",
      () =>
        invalidateAssigneeQueries(queryClient, {
          taskId: "t1",
          projectId: "p1",
          workspaceId: "w1",
        }),
    ],
    [
      "a task back from the trash",
      () => refreshAfterTaskChange(queryClient, "p1"),
    ],
  ])("%s", (_change, invalidate) => {
    invalidate();
    expect(isStale()).toBe(true);
  });

  it.each([
    [
      "a task's due date",
      () => {
        const hook = run(() => useUpdateTaskDueDate());
        return () =>
          hook.current.mutateAsync({
            ...task,
            dueDate: "2026-11-20",
          });
      },
    ],
    [
      "a new blocking link",
      () => {
        const hook = run(() => useCreateTaskRelation());
        return () =>
          hook.current.mutateAsync({
            sourceTaskId: "t1",
            targetTaskId: "t2",
            relationType: "blocks",
          });
      },
    ],
    [
      "a removed link",
      () => {
        const hook = run(() => useDeleteTaskRelation("t1"));
        return () => hook.current.mutateAsync("r1");
      },
    ],
    [
      "a task moved to the trash",
      () => {
        const hook = run(() => useDeleteTask());
        return () => hook.current.mutateAsync("t1");
      },
    ],
    [
      "tasks changed in bulk",
      () => {
        const hook = run(() => useBulkOperations());
        return () =>
          hook.current.bulkChangeStatus({
            taskIds: ["t1", "t2"],
            status: "done",
          });
      },
    ],
    [
      "a new task",
      () => {
        const hook = run(() => useCreateTask());
        return () =>
          hook.current.mutateAsync({
            title: "New",
            projectId: "p1",
            status: "to-do",
          } as never);
      },
    ],
    [
      "a copied task",
      () => {
        const hook = run(() => useCopyTask());
        return () =>
          hook.current.mutateAsync({
            taskId: "t1",
            projectId: "p1",
            title: "Copy",
            include: [],
          });
      },
    ],
    [
      "a task from a template",
      () => {
        const hook = run(() => useApplyTaskTemplate());
        return () =>
          hook.current.mutateAsync({
            templateId: "tpl1",
            projectId: "p1",
            workspaceId: "w1",
            input: {} as never,
          });
      },
    ],
    [
      "imported tasks",
      () => {
        const hook = run(() => useImportTasks());
        return () =>
          hook.current.mutateAsync({
            projectId: "p1",
            tasks: [],
          });
      },
    ],
    [
      "a column moved to another group",
      () => {
        const hook = run(() => useUpdateColumn());
        return () =>
          hook.current.mutateAsync({
            id: "col1",
            projectId: "p1",
            data: { group: "completed" },
          });
      },
    ],
    [
      "an accepted intake request",
      () => {
        const hook = run(() => useTriageIntakeItem());
        return () =>
          hook.current.mutateAsync({
            id: "i1",
            projectId: "p1",
            action: "accept",
            status: "to-do",
          });
      },
    ],
  ])("%s", async (_change, render) => {
    // Rendered first: a hook rendered inside act has no result yet.
    const mutate = render();
    await act(async () => {
      await mutate();
    });
    expect(isStale()).toBe(true);
  });

  it("a task moved to another project, on both sides", async () => {
    const move = run(() => useMoveTask());
    await act(async () => {
      await move.current.mutateAsync({
        taskId: "t1",
        destinationProjectId: "p2",
      });
    });
    expect(isStale("p1")).toBe(true);
    expect(isStale("p2")).toBe(true);
  });
});

describe("what refreshes cycle and module progress in the acting tab", () => {
  const progress = [
    cycleQueryKeys.progress("p1", "c1"),
    moduleQueryKeys.progress("p1", "m1"),
  ];

  it.each([
    [
      "tasks changed in bulk",
      () => {
        const hook = run(() => useBulkOperations());
        return () =>
          hook.current.bulkChangeStatus({ taskIds: ["t1"], status: "done" });
      },
    ],
    [
      "a task copied with its planning (cycle, modules)",
      () => {
        const hook = run(() => useCopyTask());
        return () =>
          hook.current.mutateAsync({
            taskId: "t1",
            projectId: "p1",
            title: "Copy",
            include: ["planning"],
          });
      },
    ],
  ])("%s", async (_change, render) => {
    for (const key of progress) queryClient.setQueryData(key, { total: 1 });
    const mutate = render();
    await act(async () => {
      await mutate();
    });
    for (const key of progress) {
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    }
  });
});
