import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AssigneeMultiSelect from "./assignee-multi-select";

const state = vi.hoisted(() => ({
  members: undefined as
    | Array<{ userId: string; user: { name: string; image: null } }>
    | undefined,
  isLoading: false,
}));

vi.mock(
  "@/hooks/queries/workspace-users/use-get-active-workspace-users",
  () => ({
    useGetActiveWorkspaceUsers: () => ({
      data: state.members ? { members: state.members } : undefined,
      isLoading: state.isLoading,
    }),
  }),
);

vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  default: () => ({ user: { id: "ben" } }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}(${Object.values(options).join("|")})` : key,
  }),
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => (
    <div data-testid="tooltip">{children}</div>
  ),
}));

afterEach(() => {
  cleanup();
  state.members = undefined;
  state.isLoading = false;
});

function member(id: string, name: string) {
  return { userId: id, user: { name, image: null } };
}

const TEAM = [
  member("ana", "Ana Silva"),
  member("ben", "Ben Ito"),
  member("cy", "Cy Moss"),
];

function crowd(count: number) {
  return Array.from({ length: count }, (_, index) =>
    member(`user-${index}`, `Person ${index}`),
  );
}

function rows() {
  return screen.getAllByRole("menuitemcheckbox");
}

describe("AssigneeMultiSelect", () => {
  it("lists the assignees, then me, then everyone else", () => {
    state.members = TEAM;
    render(
      <AssigneeMultiSelect
        workspaceId="ws"
        selectedIds={["cy"]}
        onToggle={vi.fn()}
      />,
    );

    const [cy, me, ana] = rows();
    expect(cy).toHaveTextContent("Cy Moss");
    expect(cy).toHaveAttribute("aria-checked", "true");
    expect(me).toHaveTextContent("tasks:assignees.you(Ben Ito)");
    expect(ana).toHaveTextContent("Ana Silva");
    expect(ana).toHaveAttribute("aria-checked", "false");
  });

  it("keeps the order it opened with while people are toggled", () => {
    state.members = TEAM;
    const view = render(
      <AssigneeMultiSelect
        workspaceId="ws"
        selectedIds={[]}
        onToggle={vi.fn()}
      />,
    );
    const before = rows().map((row) => row.textContent);

    view.rerender(
      <AssigneeMultiSelect
        workspaceId="ws"
        selectedIds={["cy"]}
        onToggle={vi.fn()}
      />,
    );

    expect(rows().map((row) => row.textContent)).toEqual(before);
    expect(rows()[2]).toHaveTextContent("Cy Moss");
    expect(rows()[2]).toHaveAttribute("aria-checked", "true");
  });

  it("reports the next checked state of a clicked row", () => {
    state.members = TEAM;
    const onToggle = vi.fn();
    render(
      <AssigneeMultiSelect
        workspaceId="ws"
        selectedIds={["ana"]}
        onToggle={onToggle}
      />,
    );

    fireEvent.click(rows()[0]);
    expect(onToggle).toHaveBeenLastCalledWith("ana", false);
    fireEvent.click(rows()[2]);
    expect(onToggle).toHaveBeenLastCalledWith("cy", true);
  });

  it("toggles the visible rows with number keys while the list is short", () => {
    state.members = TEAM;
    const onToggle = vi.fn();
    render(
      <AssigneeMultiSelect
        workspaceId="ws"
        selectedIds={[]}
        onToggle={onToggle}
      />,
    );

    fireEvent.keyDown(document, { key: "3" });
    expect(onToggle).toHaveBeenCalledWith("cy", true);
  });

  it("shows the search only above eight people and filters by name", () => {
    state.members = crowd(8);
    const view = render(
      <AssigneeMultiSelect
        workspaceId="ws"
        selectedIds={[]}
        onToggle={vi.fn()}
      />,
    );
    expect(
      screen.queryByLabelText("tasks:assignees.searchPlaceholder"),
    ).toBeNull();
    view.unmount();

    state.members = [...crowd(8), member("zed", "Zed Quinn")];
    render(
      <AssigneeMultiSelect
        workspaceId="ws"
        selectedIds={[]}
        onToggle={vi.fn()}
      />,
    );
    const search = screen.getByLabelText("tasks:assignees.searchPlaceholder");
    fireEvent.change(search, { target: { value: "QUINN" } });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toHaveTextContent("Zed Quinn");

    fireEvent.change(search, { target: { value: "nobody" } });
    expect(screen.getByText("tasks:assignees.noMatches")).toBeInTheDocument();
  });

  it("disables unselected rows at the limit, with the reason", () => {
    const people = crowd(21);
    state.members = people;
    render(
      <AssigneeMultiSelect
        workspaceId="ws"
        selectedIds={people.slice(0, 20).map((person) => person.userId)}
        onToggle={vi.fn()}
      />,
    );

    const all = rows();
    expect(all[0]).toBeEnabled();
    expect(all[20]).toBeDisabled();
    expect(screen.getByTestId("tooltip")).toHaveTextContent(
      "tasks:assignees.limitReached(20)",
    );
  });

  it("marks people on only some tasks as mixed and adds them to all", () => {
    state.members = TEAM;
    const onToggle = vi.fn();
    render(
      <AssigneeMultiSelect
        workspaceId="ws"
        selectedIds={["ana"]}
        mixedIds={["cy"]}
        onToggle={onToggle}
      />,
    );

    const cy = rows()[1];
    expect(cy).toHaveTextContent("Cy Moss");
    expect(cy).toHaveAttribute("aria-checked", "mixed");
    fireEvent.click(cy);
    expect(onToggle).toHaveBeenCalledWith("cy", true);
  });

  it("offers Clear assignees only while someone is assigned", () => {
    state.members = TEAM;
    const onClear = vi.fn();
    const view = render(
      <AssigneeMultiSelect
        workspaceId="ws"
        selectedIds={[]}
        onToggle={vi.fn()}
        onClear={onClear}
      />,
    );
    expect(screen.queryByText("tasks:assignees.clear")).toBeNull();

    view.rerender(
      <AssigneeMultiSelect
        workspaceId="ws"
        selectedIds={["ana"]}
        onToggle={vi.fn()}
        onClear={onClear}
      />,
    );
    fireEvent.click(screen.getByText("tasks:assignees.clear"));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("holds a pending row until its change settles", () => {
    state.members = TEAM;
    const onToggle = vi.fn();
    render(
      <AssigneeMultiSelect
        workspaceId="ws"
        selectedIds={["ana"]}
        pendingIds={new Set(["ana"])}
        onToggle={onToggle}
      />,
    );

    expect(rows()[0]).toHaveAttribute("aria-disabled", "true");
    expect(rows()[1]).not.toHaveAttribute("aria-disabled");
    fireEvent.click(rows()[0]);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("keeps focus on a row while its change saves", () => {
    state.members = TEAM;
    const props = {
      workspaceId: "ws",
      selectedIds: [] as string[],
      onToggle: vi.fn(),
    };
    const ana = () =>
      screen.getByRole("menuitemcheckbox", { name: /Ana Silva/ });
    const { rerender } = render(<AssigneeMultiSelect {...props} />);
    ana().focus();

    rerender(<AssigneeMultiSelect {...props} pendingIds={new Set(["ana"])} />);

    expect(ana()).toBeEnabled();
    expect(ana()).toHaveFocus();
  });

  it("names former members who are still assigned", () => {
    state.members = TEAM;
    render(
      <AssigneeMultiSelect
        workspaceId="ws"
        selectedIds={["gone"]}
        embedded={[{ id: "gone", name: "Gone Person", image: null }]}
        onToggle={vi.fn()}
      />,
    );

    expect(rows()[0]).toHaveTextContent("Gone Person");
    expect(rows()[0]).toHaveTextContent("tasks:assignees.formerMember");
  });

  it("shows the assigned people and placeholders while members load", () => {
    state.isLoading = true;
    const { container } = render(
      <AssigneeMultiSelect
        workspaceId="ws"
        selectedIds={["ana"]}
        embedded={[{ id: "ana", name: "Ana Silva", image: null }]}
        onToggle={vi.fn()}
      />,
    );

    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toHaveTextContent("Ana Silva");
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(
      3,
    );
  });

  it("says when there is nobody to assign", () => {
    state.members = [];
    render(
      <AssigneeMultiSelect
        workspaceId="ws"
        selectedIds={[]}
        onToggle={vi.fn()}
      />,
    );

    expect(screen.getByText("tasks:assignees.noMembers")).toBeInTheDocument();
  });
});
