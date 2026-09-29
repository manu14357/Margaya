import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Cycle } from "@/types/cycle";
import CycleFormDialog from "./cycle-form-dialog";
import { makeCycle } from "./test-fixtures";

const state = vi.hoisted(() => ({
  cycles: [] as unknown[],
  create: vi.fn(),
  update: vi.fn(),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) =>
      options?.name ? `${key}:${options.name}` : key,
  }),
}));

vi.mock("@/hooks/queries/cycle/use-get-cycles", () => ({
  default: () => ({ data: state.cycles }),
}));

vi.mock("@/hooks/mutations/cycle/use-create-cycle", () => ({
  useCreateCycle: () => ({ mutateAsync: state.create }),
}));

vi.mock("@/hooks/mutations/cycle/use-update-cycle", () => ({
  useUpdateCycle: () => ({ mutateAsync: state.update }),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: { user: { id: "me" } } }) },
}));

vi.mock(
  "@/hooks/queries/workspace-users/use-get-active-workspace-users",
  () => ({ useGetActiveWorkspaceUsers: () => ({ data: { members: [] } }) }),
);

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  state.cycles = [];
  state.create.mockReset();
  state.update.mockReset();
});

function renderDialog(cycle?: Cycle) {
  render(
    <CycleFormDialog
      open
      onOpenChange={vi.fn()}
      projectId="project-1"
      workspaceId="ws-1"
      cycle={cycle}
    />,
  );
}

describe("CycleFormDialog", () => {
  it("requires a name", async () => {
    renderDialog();
    fireEvent.click(
      await screen.findByRole("button", { name: "cycles:form.create" }),
    );
    expect(
      await screen.findByText("cycles:form.errors.nameRequired"),
    ).toBeInTheDocument();
    expect(state.create).not.toHaveBeenCalled();
  });

  it("names the cycle whose dates overlap", async () => {
    const other = makeCycle({
      id: "a",
      name: "Sprint A",
      startDate: "2026-03-01",
      endDate: "2026-03-14",
    });
    const edited = makeCycle({
      id: "b",
      name: "Sprint B",
      status: "upcoming",
      startDate: "2026-03-10",
      endDate: "2026-03-20",
    });
    state.cycles = [other, edited];
    renderDialog(edited);
    fireEvent.click(
      await screen.findByRole("button", { name: "cycles:form.save" }),
    );
    expect(
      await screen.findByText("cycles:form.errors.overlap:Sprint A"),
    ).toBeInTheDocument();
    expect(state.update).not.toHaveBeenCalled();
  });

  it("locks the start date of a running cycle", async () => {
    renderDialog(makeCycle({ status: "current" }));
    expect(
      await screen.findByText("cycles:form.startLocked"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "cycles:form.clearDates" }),
    ).toBeNull();
  });

  it("sends calendar days as YYYY-MM-DD", async () => {
    state.cycles = [
      makeCycle({
        id: "draft",
        status: "draft",
        startDate: null,
        endDate: null,
        today: "2000-01-01",
      }),
    ];
    state.create.mockResolvedValue(makeCycle());
    renderDialog();
    fireEvent.change(await screen.findByLabelText("cycles:form.nameLabel"), {
      target: { value: "  Sprint 9 " },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "cycles:form.datesLabel" }),
    );
    fireEvent.click(
      (await screen.findByText("10")).closest("button") as HTMLElement,
    );
    fireEvent.click(screen.getByText("12").closest("button") as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "cycles:form.create" }));

    await waitFor(() =>
      expect(state.create).toHaveBeenCalledWith({
        projectId: "project-1",
        name: "Sprint 9",
        description: "",
        startDate: "2000-01-10",
        endDate: "2000-01-12",
        ownerId: "me",
      }),
    );
  });
});
