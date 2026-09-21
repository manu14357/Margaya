import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  filterSlotsByFeature,
  getTaskPropertySlots,
  registerTaskPropertySlot,
  runCreateModalSlots,
  TaskPropertySlotOutlet,
} from "./task-property-slots";

const mocks = vi.hoisted(() => ({
  useGetProject: vi.fn(),
}));

vi.mock("@/hooks/queries/project/use-get-project", () => ({
  default: (args: unknown) => mocks.useGetProject(args),
}));

vi.mock("@/constants/project-features", () => ({
  isProjectFeatureEnabled: (
    project: Record<string, boolean> | undefined,
    key: string,
  ) => key !== "modules" && project?.[`${key}Enabled`] === true,
}));

const cleanups: Array<() => void> = [];

afterEach(() => {
  cleanup();
  for (const undo of cleanups.splice(0)) undo();
  vi.clearAllMocks();
});

const task = {
  id: "task-1",
  title: "Task",
  number: 1,
  description: null,
  status: "to-do",
  priority: null,
  startDate: null,
  dueDate: null,
  position: 0,
  createdAt: "",
  userId: null,
  assigneeId: null,
  assigneeName: null,
  projectId: "project-1",
};

describe("TaskPropertySlotOutlet", () => {
  it("renders nothing and runs no hooks when no slot is registered", () => {
    const { container } = render(
      <TaskPropertySlotOutlet
        location="cardChip"
        projectId="project-1"
        workspaceId="ws-1"
        props={{ task }}
      />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(mocks.useGetProject).not.toHaveBeenCalled();
  });

  it("renders registered slots in order and hides feature-gated ones", () => {
    mocks.useGetProject.mockReturnValue({
      data: { cyclesEnabled: true, estimatesEnabled: false },
    });
    cleanups.push(
      registerTaskPropertySlot("cardChip", {
        id: "second",
        order: 2,
        Component: () => <span>second</span>,
      }),
      registerTaskPropertySlot("cardChip", {
        id: "first",
        order: 1,
        feature: "cycles",
        Component: ({ task: slotTask }) => <span>first {slotTask.id}</span>,
      }),
      registerTaskPropertySlot("cardChip", {
        id: "hidden",
        feature: "estimates",
        Component: () => <span>hidden</span>,
      }),
    );

    render(
      <TaskPropertySlotOutlet
        location="cardChip"
        projectId="project-1"
        workspaceId="ws-1"
        props={{ task }}
      />,
    );

    const texts = screen.getAllByText(/first|second/).map((n) => n.textContent);
    expect(texts).toEqual(["first task-1", "second"]);
    expect(screen.queryByText("hidden")).toBeNull();
    expect(mocks.useGetProject).toHaveBeenCalledWith({
      id: "project-1",
      workspaceId: "ws-1",
    });
  });

  it("lets the host wrap each slot", () => {
    mocks.useGetProject.mockReturnValue({ data: undefined });
    cleanups.push(
      registerTaskPropertySlot("bulkAction", {
        id: "action",
        Component: ({ taskIds }) => (
          <button type="button">{taskIds.length}</button>
        ),
      }),
    );

    render(
      <TaskPropertySlotOutlet
        location="bulkAction"
        projectId="project-1"
        workspaceId="ws-1"
        props={{ taskIds: ["a", "b"], surface: "board", onDone: () => {} }}
        renderSlot={(node, slot) => <div data-testid={slot.id}>{node}</div>}
      />,
    );

    expect(screen.getByTestId("action")).toHaveTextContent("2");
  });

  it("gives context-menu slots the task", () => {
    mocks.useGetProject.mockReturnValue({ data: { cyclesEnabled: true } });
    cleanups.push(
      registerTaskPropertySlot("contextMenu", {
        id: "cycle",
        feature: "cycles",
        Component: ({ task: slotTask, projectId }) => (
          <span>
            menu {slotTask.id} {projectId}
          </span>
        ),
      }),
    );

    render(
      <TaskPropertySlotOutlet
        location="contextMenu"
        projectId="project-1"
        workspaceId="ws-1"
        props={{ task }}
      />,
    );

    expect(screen.getByText("menu task-1 project-1")).toBeInTheDocument();
  });
});

it("passes per-slot props from a function", () => {
  mocks.useGetProject.mockReturnValue({ data: undefined });
  cleanups.push(
    registerTaskPropertySlot("createModal", {
      id: "estimate",
      Component: ({ value }) => <span>value {String(value)}</span>,
    }),
  );

  render(
    <TaskPropertySlotOutlet
      location="createModal"
      projectId="project-1"
      workspaceId="ws-1"
      props={(slot) => ({ value: slot.id, onChange: () => {} })}
    />,
  );

  expect(screen.getByText("value estimate")).toBeInTheDocument();
});

describe("registry helpers", () => {
  it("replaces a slot registered twice under the same id", () => {
    const Component = () => null;
    cleanups.push(
      registerTaskPropertySlot("sidebar", { id: "cycle", Component }),
      registerTaskPropertySlot("sidebar", { id: "cycle", order: 3, Component }),
    );
    expect(getTaskPropertySlots("sidebar")).toHaveLength(1);
    expect(getTaskPropertySlots("sidebar")[0]?.order).toBe(3);
  });

  it("filters slots by feature", () => {
    const Component = () => null;
    const slots = [
      { id: "always", Component },
      { id: "cycle", feature: "cycles" as const, Component },
    ];
    expect(
      filterSlotsByFeature(slots, () => false).map((slot) => slot.id),
    ).toEqual(["always"]);
  });

  it("runs afterCreate only for slots holding a value", async () => {
    const withValue = vi.fn();
    const withoutValue = vi.fn();
    const failing = vi.fn().mockRejectedValue(new Error("nope"));
    const Component = () => null;
    cleanups.push(
      registerTaskPropertySlot("createModal", {
        id: "a",
        Component,
        afterCreate: withValue,
      }),
      registerTaskPropertySlot("createModal", {
        id: "b",
        Component,
        afterCreate: withoutValue,
      }),
      registerTaskPropertySlot("createModal", {
        id: "c",
        Component,
        afterCreate: failing,
      }),
    );

    const errors = await runCreateModalSlots({
      task: { id: "t1", projectId: "p1" },
      values: { a: "cycle-1", c: 3 },
    });

    expect(withValue).toHaveBeenCalledWith({
      task: { id: "t1", projectId: "p1" },
      value: "cycle-1",
    });
    expect(withoutValue).not.toHaveBeenCalled();
    expect(errors).toHaveLength(1);
  });
});
