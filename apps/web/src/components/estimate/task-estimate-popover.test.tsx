import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type Task from "@/types/task";
import TaskEstimatePopover from "./task-estimate-popover";
import TaskEstimateProperty from "./task-estimate-property";
import { makeEstimate, testTranslate } from "./test-fixtures";

// Base UI dialogs and popovers render slowly while the whole suite runs.
vi.setConfig({ testTimeout: 15_000 });

const state = vi.hoisted(() => ({
  canUpdateTasks: true,
  mutate: vi.fn(),
  refetch: vi.fn(),
  active: null as ReturnType<typeof makeEstimate> | null,
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: testTranslate }),
}));

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canUpdateTasks: () => state.canUpdateTasks,
  }),
}));

vi.mock("@/hooks/mutations/estimate/use-update-task-estimate", () => ({
  useUpdateTaskEstimate: () => ({ mutate: state.mutate }),
}));

vi.mock("@/hooks/use-numbered-shortcuts", () => ({
  useNumberedShortcuts: vi.fn(),
}));

vi.mock("@/hooks/queries/estimate/use-active-estimate", async () => {
  const { getEstimateValueMap } = await import("@/lib/estimate/totals");
  return {
    useActiveEstimate: () => ({
      estimate: state.active,
      isActive: state.active !== null,
      pointsById: getEstimateValueMap(state.active),
      isFetching: false,
      refetch: state.refetch,
    }),
  };
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  state.canUpdateTasks = true;
  state.active = null;
  state.mutate.mockReset();
  state.refetch.mockReset();
});

// Deliberately out of order: the list follows position.
const estimate = {
  ...makeEstimate("points", ["1", "3", "5"]),
};
estimate.points = [estimate.points[2], estimate.points[0], estimate.points[1]];

function renderPopover(estimatePointId: string | null) {
  render(
    <TaskEstimatePopover
      task={{ id: "task-1", projectId: "project-1", estimatePointId }}
      estimate={estimate}
    >
      <button type="button">Estimate</button>
    </TaskEstimatePopover>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Estimate" }));
}

function optionTexts() {
  return screen
    .getAllByRole("button")
    .filter((button) => button.textContent !== "Estimate")
    .map((button) => button.textContent ?? "");
}

describe("TaskEstimatePopover", () => {
  it("lists No estimate, then the values in position order", async () => {
    renderPopover(null);
    await screen.findByText("tasks:estimate.none");
    expect(optionTexts().map((text) => text.replace(/\d$/, ""))).toEqual([
      "tasks:estimate.none",
      "1 pts",
      "3 pts",
      "5 pts",
    ]);
  });

  it("checks the current value and saves a new one", async () => {
    renderPopover("estimate-1-p2");
    const current = (await screen.findByText("3 pts")).closest("button");
    expect(current?.querySelector("svg.lucide-check")).not.toBeNull();

    fireEvent.click(screen.getByText("5 pts"));
    expect(state.mutate).toHaveBeenCalledWith(
      {
        taskId: "task-1",
        projectId: "project-1",
        estimatePointId: "estimate-1-p3",
      },
      expect.any(Object),
    );
  });

  it("clears the estimate with No estimate", async () => {
    renderPopover("estimate-1-p1");
    fireEvent.click(await screen.findByText("tasks:estimate.none"));
    expect(state.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ estimatePointId: null }),
      expect.any(Object),
    );
  });

  it("does nothing when the current value is picked again", async () => {
    renderPopover("estimate-1-p1");
    fireEvent.click(await screen.findByText("1 pts"));
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it("only shows the trigger without task:update", () => {
    state.canUpdateTasks = false;
    renderPopover("estimate-1-p1");
    expect(screen.queryByText("tasks:estimate.none")).toBeNull();
  });
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
  createdAt: "2026-09-01T00:00:00.000Z",
  userId: null,
  assigneeId: null,
  assigneeName: null,
  projectId: "project-1",
} satisfies Task;

function renderProperty(estimatePointId: string | null) {
  return render(
    <TaskEstimateProperty
      task={{ ...task, estimatePointId }}
      layout="stack"
      projectId="project-1"
      workspaceId="workspace-1"
    />,
  );
}

describe("TaskEstimateProperty", () => {
  it("renders nothing while estimates are inactive", () => {
    const { container } = renderProperty("estimate-1-p1");
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the value with its unit", () => {
    state.active = makeEstimate("time", ["30", "90"]);
    renderProperty("estimate-1-p2");
    expect(screen.getByRole("button")).toHaveTextContent("1h 30m");
  });

  it("shows No estimate and refetches for a value it doesn't know", () => {
    state.active = makeEstimate("points", ["1", "2"]);
    renderProperty("added-elsewhere");
    expect(screen.getByRole("button")).toHaveTextContent("tasks:estimate.none");
    expect(state.refetch).toHaveBeenCalledTimes(1);
  });
});
