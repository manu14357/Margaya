import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TaskCyclePopover from "./task-cycle-popover";
import { makeCycle } from "./test-fixtures";

const state = vi.hoisted(() => ({
  canUpdateCycles: true,
  mutate: vi.fn(),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canUpdateCycles: () => state.canUpdateCycles,
  }),
}));

vi.mock("@/hooks/mutations/cycle/use-set-task-cycle", () => ({
  useSetTaskCycle: () => ({ mutate: state.mutate }),
}));

vi.mock("@/hooks/use-numbered-shortcuts", () => ({
  useNumberedShortcuts: vi.fn(),
}));

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  state.canUpdateCycles = true;
  state.mutate.mockReset();
});

const cycles = [
  makeCycle({ id: "current", name: "Now", status: "current" }),
  makeCycle({ id: "next", name: "Next", status: "upcoming" }),
  makeCycle({ id: "draft", name: "Someday", status: "draft" }),
  makeCycle({ id: "done", name: "Finished", status: "completed" }),
];

function renderPopover(
  cycleId: string | null,
  currentCycle = null as ReturnType<typeof makeCycle> | null,
) {
  render(
    <TaskCyclePopover
      task={{ id: "task-1", projectId: "project-1", cycleId }}
      cycles={cycles}
      currentCycle={currentCycle}
    >
      <button type="button">Cycle</button>
    </TaskCyclePopover>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Cycle" }));
}

function optionNames() {
  return screen
    .getAllByRole("button")
    .filter((button) => button.textContent !== "Cycle")
    .map((button) => button.textContent ?? "");
}

describe("TaskCyclePopover", () => {
  it("offers No cycle first, then open cycles, never completed ones", async () => {
    renderPopover("next", cycles[1]);
    await screen.findByText("cycles:picker.none");
    const names = optionNames();
    expect(names[0]).toContain("cycles:picker.none");
    expect(names.some((name) => name.includes("Now"))).toBe(true);
    expect(names.some((name) => name.includes("Someday"))).toBe(true);
    expect(names.some((name) => name.includes("Finished"))).toBe(false);
  });

  it("checks the task's cycle and moves the task on select", async () => {
    renderPopover("next", cycles[1]);
    const next = (await screen.findByText("Next")).closest("button");
    expect(next?.querySelector("svg.lucide-check")).not.toBeNull();

    fireEvent.click(screen.getByText("Now"));
    expect(state.mutate).toHaveBeenCalledWith(
      { taskId: "task-1", projectId: "project-1", cycleId: "current" },
      expect.any(Object),
    );
  });

  it("lists a completed current cycle first, disabled and badged", async () => {
    renderPopover("done", cycles[3]);
    const finished = (await screen.findByText("Finished")).closest("button");
    expect(finished).toBeDisabled();
    expect(finished).toHaveTextContent("cycles:picker.completedBadge");
    expect(optionNames()[1]).toContain("Finished");
  });

  it("removes the task from its cycle with No cycle", async () => {
    renderPopover("next", cycles[1]);
    fireEvent.click(await screen.findByText("cycles:picker.none"));
    expect(state.mutate).toHaveBeenCalledWith(
      { taskId: "task-1", projectId: "project-1", cycleId: null },
      expect.any(Object),
    );
  });

  it("only shows the trigger without cycle:update", () => {
    state.canUpdateCycles = false;
    renderPopover("next", cycles[1]);
    expect(screen.queryByText("cycles:picker.none")).toBeNull();
  });
});
