import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeCycle } from "./test-fixtures";
import TransferTasksDialog from "./transfer-tasks-dialog";

const state = vi.hoisted(() => ({
  cycles: [] as unknown[],
  mutate: vi.fn(),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/queries/cycle/use-get-cycles", () => ({
  default: () => ({ data: state.cycles, isLoading: false }),
}));

vi.mock("@/hooks/mutations/cycle/use-transfer-cycle-tasks", () => ({
  useTransferCycleTasks: () => ({ mutate: state.mutate, isPending: false }),
}));

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canCreateCycles: () => true }),
}));

vi.mock("./cycle-form-dialog", () => ({ default: () => null }));

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  state.mutate.mockReset();
});

const source = makeCycle({
  id: "source",
  name: "Old sprint",
  status: "completed",
  pending: 3,
});

function renderDialog() {
  render(
    <TransferTasksDialog
      cycle={source}
      workspaceId="ws-1"
      open
      onOpenChange={vi.fn()}
    />,
  );
}

describe("TransferTasksDialog", () => {
  it("offers open cycles except the source, completed and archived ones", async () => {
    state.cycles = [
      source,
      makeCycle({ id: "now", name: "Now", status: "current" }),
      makeCycle({ id: "later", name: "Later", status: "draft" }),
      makeCycle({ id: "done", name: "Done sprint", status: "completed" }),
      makeCycle({
        id: "gone",
        name: "Archived sprint",
        status: "completed",
        archivedAt: "2026-01-01T00:00:00.000Z",
      }),
    ];
    renderDialog();
    expect(await screen.findByText("Now")).toBeInTheDocument();
    expect(screen.getByText("Later")).toBeInTheDocument();
    expect(screen.queryByText("Old sprint")).toBeNull();
    expect(screen.queryByText("Done sprint")).toBeNull();
    expect(screen.queryByText("Archived sprint")).toBeNull();
  });

  it("transfers to the clicked cycle", async () => {
    state.cycles = [
      source,
      makeCycle({ id: "now", name: "Now", status: "current" }),
    ];
    renderDialog();
    fireEvent.click(await screen.findByText("Now"));
    expect(state.mutate).toHaveBeenCalledWith(
      { cycleId: "source", projectId: "project-1", targetCycleId: "now" },
      expect.any(Object),
    );
  });

  it("explains when no cycle can take the tasks", async () => {
    state.cycles = [source];
    renderDialog();
    expect(
      await screen.findByText("cycles:transfer.noTargets"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /cycles:transfer.newCycle/ }),
    ).toBeInTheDocument();
  });
});
