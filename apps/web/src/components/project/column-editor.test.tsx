import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ColumnEditor from "./column-editor";

const mocks = vi.hoisted(() => ({
  columns: vi.fn(),
  updateColumn: vi.fn(),
  canManageProjects: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/queries/column/use-get-columns", () => ({
  useGetColumns: () => ({ data: mocks.columns(), isLoading: false }),
}));
vi.mock("@/hooks/mutations/column/use-update-column", () => ({
  useUpdateColumn: () => ({ mutateAsync: mocks.updateColumn }),
}));
vi.mock("@/hooks/mutations/column/use-create-column", () => ({
  useCreateColumn: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/mutations/column/use-delete-column", () => ({
  useDeleteColumn: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/mutations/column/use-reorder-columns", () => ({
  useReorderColumns: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canManageProjects: mocks.canManageProjects,
  }),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// The real picker is a portalled listbox; a native select keeps the test on
// the editor's wiring.
vi.mock("./column-group-select", () => ({
  default: (props: {
    value: string;
    onChange: (group: string) => void;
    disabled?: boolean;
    "aria-label"?: string;
  }) => (
    <select
      aria-label={props["aria-label"]}
      value={props.value}
      disabled={props.disabled}
      onChange={(event) => props.onChange(event.target.value)}
    >
      {["backlog", "unstarted", "started", "completed", "cancelled"].map(
        (group) => (
          <option key={group} value={group}>
            {group}
          </option>
        ),
      )}
    </select>
  ),
}));

beforeEach(() => {
  mocks.canManageProjects.mockReturnValue(true);
  mocks.updateColumn.mockResolvedValue({});
  mocks.columns.mockReturnValue([
    {
      id: "c1",
      slug: "to-do",
      name: "To Do",
      icon: null,
      position: 0,
      group: "unstarted",
      isFinal: false,
    },
    {
      id: "c2",
      slug: "done",
      name: "Done",
      icon: null,
      position: 1,
      group: "completed",
      isFinal: true,
    },
    {
      id: "c3",
      slug: "inbox",
      name: "Inbox",
      icon: null,
      position: 2,
      group: "triage",
      isFinal: false,
    },
  ]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ColumnEditor", () => {
  it("shows a group picker per column and hides triage columns", () => {
    render(<ColumnEditor projectId="project-1" />);
    const pickers = screen.getAllByLabelText(
      "settings:columnEditor.groupPickerAria",
    );
    expect(pickers).toHaveLength(2);
    expect(
      pickers.map((picker) => (picker as HTMLSelectElement).value),
    ).toEqual(["unstarted", "completed"]);
    expect(screen.queryByDisplayValue("Inbox")).toBeNull();
    // The group picker replaced the old "Done column" switch.
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("saves a group change", () => {
    render(<ColumnEditor projectId="project-1" />);
    const [first] = screen.getAllByLabelText(
      "settings:columnEditor.groupPickerAria",
    );
    fireEvent.change(first, { target: { value: "started" } });
    expect(mocks.updateColumn).toHaveBeenCalledWith({
      id: "c1",
      projectId: "project-1",
      data: { group: "started" },
    });
  });

  it("disables the pickers without permission", () => {
    mocks.canManageProjects.mockReturnValue(false);
    render(<ColumnEditor projectId="project-1" />);
    for (const picker of screen.getAllByLabelText(
      "settings:columnEditor.groupPickerAria",
    )) {
      expect(picker).toBeDisabled();
    }
  });

  it("warns when no column is in the completed group", () => {
    mocks.columns.mockReturnValue([
      {
        id: "c1",
        slug: "to-do",
        name: "To Do",
        icon: null,
        position: 0,
        group: "unstarted",
        isFinal: false,
      },
    ]);
    render(<ColumnEditor projectId="project-1" />);
    expect(
      screen.getByText("settings:columnEditor.noCompletedWarning"),
    ).toBeInTheDocument();
  });
});
