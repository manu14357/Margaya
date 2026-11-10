import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShellContext } from "@/components/common/shell-context";
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
    bulkMoveToProject: vi.fn(),
  },
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// The real module too: the calendar's date formatting loads the i18n setup.
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count !== undefined ? `${key}(${options.count})` : key,
  }),
}));
vi.mock("@/hooks/mutations/task/use-bulk-operations", () => ({
  useBulkOperations: () => mocks.ops,
}));
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({
    data: [
      { id: "project-here", name: "Here" },
      { id: "project-there", name: "There" },
    ],
  }),
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

  it("sits in the shell's main column, so it centres on the work, not the window", () => {
    const mainColumn = document.createElement("main");
    document.body.append(mainColumn);
    render(
      <ShellContext.Provider
        value={{
          destination: "home",
          selectDestination: vi.fn(),
          panelSlot: null,
          mainColumn,
        }}
      >
        <BulkToolbar projectId={null} />
      </ShellContext.Provider>,
    );

    const toolbar = screen.getByRole("toolbar");
    expect(mainColumn.contains(toolbar)).toBe(true);
    expect(toolbar.parentElement).toHaveClass("absolute", "left-1/2");
    mainColumn.remove();
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

  it("moves the selection to a project after confirming the rule", async () => {
    mocks.ops.bulkMoveToProject.mockResolvedValue({ updatedCount: 2 });
    render(<BulkToolbar projectId="project-here" />);
    openActions();

    expect(await screen.findByText("tasks:bulk.moveToProject")).toBeTruthy();
    // The current project is not a destination.
    expect(screen.queryByText("Here")).toBeNull();
    fireEvent.click(screen.getByText("There"));

    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText("tasks:bulk.moveToProjectRule")).toBeTruthy();
    expect(mocks.ops.bulkMoveToProject).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "tasks:bulk.moveToProjectConfirm" }),
    );

    await waitFor(() =>
      expect(mocks.ops.bulkMoveToProject).toHaveBeenCalledWith({
        taskIds: ["t1", "t2"],
        projectId: "project-there",
      }),
    );
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith(
        "tasks:bulk.moveToProjectSuccess(2)",
      ),
    );
    expect(useBulkSelectionStore.getState().selectedTaskIds.size).toBe(0);
  });

  it("keeps the selection when a move is cancelled or refused", async () => {
    mocks.ops.bulkMoveToProject.mockRejectedValue(new Error("refused"));
    render(<BulkToolbar projectId="project-here" />);
    openActions();
    fireEvent.click(await screen.findByText("There"));

    fireEvent.click(await screen.findByText("common:actions.cancel"));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(mocks.ops.bulkMoveToProject).not.toHaveBeenCalled();

    openActions();
    fireEvent.click(await screen.findByText("There"));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "tasks:bulk.moveToProjectConfirm",
      }),
    );

    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        "tasks:bulk.moveToProjectError",
      ),
    );
    expect(useBulkSelectionStore.getState().selectedTaskIds.size).toBe(2);
  });

  it("asks in an in-app dialog before moving the selection to the trash", async () => {
    mocks.ops.bulkDelete.mockResolvedValue(undefined);
    const nativeConfirm = vi.spyOn(window, "confirm");
    render(<BulkToolbar projectId={null} />);
    openActions();
    fireEvent.click(await screen.findByText("tasks:bulk.delete"));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("tasks:bulk.deleteConfirmTitle(2)");
    expect(dialog).toHaveTextContent("tasks:bulk.deleteConfirmDescription(2)");
    expect(mocks.ops.bulkDelete).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "tasks:bulk.deleteConfirmAction" }),
    );

    await waitFor(() =>
      expect(mocks.ops.bulkDelete).toHaveBeenCalledWith(["t1", "t2"]),
    );
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith(
        "tasks:bulk.deleteSuccess(2)",
      ),
    );
    expect(useBulkSelectionStore.getState().selectedTaskIds.size).toBe(0);
    expect(nativeConfirm).not.toHaveBeenCalled();
    nativeConfirm.mockRestore();
  });

  it("deletes nothing and keeps the selection when the delete is cancelled", async () => {
    render(<BulkToolbar projectId={null} />);
    openActions();
    fireEvent.click(await screen.findByText("tasks:bulk.delete"));

    fireEvent.click(
      await screen.findByRole("button", { name: "common:actions.cancel" }),
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

    // Escape in the dialog cancels it too, without clearing the selection.
    openActions();
    fireEvent.click(await screen.findByText("tasks:bulk.delete"));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

    expect(mocks.ops.bulkDelete).not.toHaveBeenCalled();
    expect(useBulkSelectionStore.getState().selectedTaskIds.size).toBe(2);
  });

  it("keeps the dialog and the selection when the delete fails", async () => {
    mocks.ops.bulkDelete.mockRejectedValue(new Error("refused"));
    render(<BulkToolbar projectId={null} />);
    openActions();
    fireEvent.click(await screen.findByText("tasks:bulk.delete"));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "tasks:bulk.deleteConfirmAction",
      }),
    );

    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("tasks:bulk.deleteError"),
    );
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(useBulkSelectionStore.getState().selectedTaskIds.size).toBe(2);
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
