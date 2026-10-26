import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useBulkSelectionStore from "@/store/bulk-selection";
import BulkToolbar from "./bulk-toolbar";

const mocks = vi.hoisted(() => ({
  ops: {
    bulkMoveToBacklog: vi.fn(),
    bulkDelete: vi.fn(),
    bulkArchive: vi.fn(),
    bulkUnarchive: vi.fn(),
    bulkChangeStatus: vi.fn(),
    bulkPriority: vi.fn(),
    bulkAddLabel: vi.fn(),
    bulkRemoveLabel: vi.fn(),
    bulkDueDate: vi.fn(),
    bulkStartDate: vi.fn(),
  },
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count !== undefined ? `${key}(${options.count})` : key,
  }),
}));
vi.mock("@/hooks/mutations/task/use-bulk-operations", () => ({
  useBulkOperations: () => mocks.ops,
}));
vi.mock("@/hooks/queries/column/use-get-columns", () => ({
  useGetColumns: () => ({ data: [] }),
}));
vi.mock("@/hooks/queries/label/use-get-labels-by-workspace", () => ({
  default: () => ({
    data: [
      {
        id: "label-bug",
        name: "Bug",
        color: "red",
        taskId: null,
        workspaceId: "ws-1",
      },
    ],
  }),
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "ws-1" } }),
}));
vi.mock("@/hooks/use-lift-toasts", () => ({ useLiftToasts: () => {} }));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canUpdateTasks: () => true,
    canDeleteTasks: () => true,
    canAssignTasks: () => false,
    canUpdateLabels: () => true,
  }),
}));
vi.mock("./use-bulk-assignee-groups", () => ({
  useBulkAssigneeGroups: () => [],
}));
vi.mock("@/lib/task-property-slots", () => ({
  TaskPropertySlotOutlet: () => null,
}));
vi.mock("@/store/project", () => ({
  default: () => ({ project: undefined }),
}));
vi.mock("@/lib/toast", () => ({ toast: mocks.toast }));

beforeEach(() => {
  act(() => {
    useBulkSelectionStore.setState({
      selectedTaskIds: new Set(["t1", "t2"]),
    });
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function openActions() {
  fireEvent.click(screen.getByRole("button", { name: /tasks:bulk.actions/ }));
}

describe("BulkToolbar", () => {
  it("removes a label from every selected task", async () => {
    mocks.ops.bulkRemoveLabel.mockResolvedValue({ updatedCount: 2 });
    render(<BulkToolbar projectId={null} />);
    openActions();

    expect(await screen.findByText("tasks:bulk.removeLabel")).toBeTruthy();
    const bugOptions = screen.getAllByText("Bug");
    // Add label comes first, then Remove label.
    fireEvent.click(bugOptions[bugOptions.length - 1] as HTMLElement);

    await waitFor(() =>
      expect(mocks.ops.bulkRemoveLabel).toHaveBeenCalledWith({
        taskIds: ["t1", "t2"],
        labelId: "label-bug",
      }),
    );
    expect(mocks.ops.bulkAddLabel).not.toHaveBeenCalled();
    expect(mocks.toast.success).toHaveBeenCalledWith(
      "tasks:bulk.removeLabelSuccess(2)",
    );
  });

  it("restores archived tasks and says when none were archived", async () => {
    mocks.ops.bulkUnarchive.mockResolvedValue({ updatedCount: 0 });
    render(<BulkToolbar projectId={null} />);
    openActions();

    fireEvent.click(await screen.findByText("tasks:bulk.unarchive"));

    await waitFor(() =>
      expect(mocks.ops.bulkUnarchive).toHaveBeenCalledWith(["t1", "t2"]),
    );
    expect(mocks.toast.info).toHaveBeenCalledWith("tasks:bulk.unarchiveNone");
  });

  it("clears the start date when the start date field is chosen", async () => {
    mocks.ops.bulkStartDate.mockResolvedValue({ updatedCount: 2 });
    render(<BulkToolbar projectId={null} />);

    fireEvent.click(
      screen.getByRole("button", { name: /tasks:bulk.setDates/ }),
    );
    fireEvent.click(await screen.findByText("tasks:bulk.startDate"));
    fireEvent.click(screen.getByText("tasks:bulk.clearStartDate"));

    await waitFor(() =>
      expect(mocks.ops.bulkStartDate).toHaveBeenCalledWith({
        taskIds: ["t1", "t2"],
        startDate: null,
      }),
    );
    expect(mocks.ops.bulkDueDate).not.toHaveBeenCalled();
  });

  it("keeps the due date as the default date field", async () => {
    mocks.ops.bulkDueDate.mockResolvedValue({ updatedCount: 2 });
    render(<BulkToolbar projectId={null} />);

    fireEvent.click(
      screen.getByRole("button", { name: /tasks:bulk.setDates/ }),
    );
    fireEvent.click(await screen.findByText("tasks:bulk.clearDueDate"));

    await waitFor(() =>
      expect(mocks.ops.bulkDueDate).toHaveBeenCalledWith({
        taskIds: ["t1", "t2"],
        dueDate: null,
      }),
    );
  });
});
