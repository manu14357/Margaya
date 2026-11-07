import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import useBuildWithAiStore from "@/store/build-with-ai";
import BuildWithAiDialog from "./build-with-ai-dialog";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

let available = true;
vi.mock("@/hooks/queries/ai/use-ai", () => ({
  useAiAvailability: () => ({ available }),
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "ws-1" } }),
}));
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({ data: [{ id: "p-1", name: "Website" }] }),
}));
let canUpdateProjects = true;
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canCreateProjects: () => true,
    canCreateTasks: () => true,
    canUpdateProjects: () => canUpdateProjects,
  }),
}));
const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));

const proposeBuild = vi.fn();
const applyBuild = vi.fn();
const undoBuild = vi.fn();
vi.mock("@/fetchers/ai/build", () => ({
  proposeBuild: (...args: unknown[]) => proposeBuild(...args),
  applyBuild: (...args: unknown[]) => applyBuild(...args),
  undoBuild: (...args: unknown[]) => undoBuild(...args),
}));

const PROPOSAL = {
  summary: "A plan.",
  project: { name: "Relaunch", key: "RL", description: "Q4" },
  columns: [{ name: "QA" }],
  labels: [],
  cycles: [],
  modules: [],
  tasks: [
    {
      title: "Audit pages",
      description: "",
      priority: "high",
      estimate: null,
      column: null,
      labels: [],
      cycleRef: null,
      moduleRef: null,
      subtasks: [],
    },
    {
      title: "Ship homepage",
      description: "",
      priority: "urgent",
      estimate: null,
      column: null,
      labels: [],
      cycleRef: null,
      moduleRef: null,
      subtasks: [],
    },
  ],
};

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

beforeEach(() => {
  available = true;
  canUpdateProjects = true;
  proposeBuild.mockReset();
  applyBuild.mockReset();
  undoBuild.mockReset();
  navigate.mockReset();
  act(() => {
    useBuildWithAiStore.getState().close();
    useBuildWithAiStore.getState().setLastBuild(null);
  });
});
afterEach(cleanup);

async function draftPlan() {
  fireEvent.change(screen.getByLabelText("ai:build.promptLabel"), {
    target: { value: "plan a relaunch" },
  });
  fireEvent.click(screen.getByRole("button", { name: "ai:build.draft" }));
  await screen.findByText("A plan.");
}

describe("BuildWithAiDialog", () => {
  it("renders nothing while AI is unavailable", () => {
    available = false;
    act(() => useBuildWithAiStore.getState().openBuild(null));
    render(<BuildWithAiDialog />, { wrapper });
    expect(screen.queryByText("ai:build.title")).not.toBeInTheDocument();
  });

  it("drafts a plan whose items can be unchecked, creating nothing yet", async () => {
    proposeBuild.mockResolvedValue({
      proposal: PROPOSAL,
      target: null,
      model: "m",
    });
    applyBuild.mockImplementation(async (_body, onProgress) => {
      onProgress({
        done: 1,
        total: 3,
        kind: "project",
        name: "Relaunch",
        ok: true,
      });
      return {
        projectId: "p-new",
        total: 3,
        done: 3,
        created: {
          project: true,
          columns: 1,
          cycles: 0,
          modules: 0,
          tasks: 1,
          subtasks: 0,
          labels: 0,
        },
        estimatesSkipped: false,
        failures: [],
      };
    });
    act(() => useBuildWithAiStore.getState().openBuild(null));
    render(<BuildWithAiDialog />, { wrapper });
    await draftPlan();

    expect(proposeBuild).toHaveBeenCalledWith(
      { workspaceId: "ws-1", prompt: "plan a relaunch", depth: "balanced" },
      expect.any(AbortSignal),
    );
    // The column, then the two tasks.
    const boxes = screen.getAllByRole("checkbox", {
      name: "ai:build.review.include",
    });
    expect(boxes).toHaveLength(3);
    fireEvent.click(boxes[1] as HTMLElement);
    expect(screen.getByDisplayValue("Audit pages")).toBeDisabled();
    // Nothing is created before Create.
    expect(applyBuild).not.toHaveBeenCalled();
  });

  it("sends only checked items to apply and reports the result", async () => {
    proposeBuild.mockResolvedValue({
      proposal: PROPOSAL,
      target: null,
      model: "m",
    });
    applyBuild.mockResolvedValue({
      projectId: "p-new",
      total: 2,
      done: 2,
      created: {
        project: true,
        columns: 0,
        cycles: 0,
        modules: 0,
        tasks: 1,
        subtasks: 0,
        labels: 0,
      },
      estimatesSkipped: false,
      failures: [
        { kind: "task", name: "Ship homepage", status: 403, message: "No" },
      ],
    });
    canUpdateProjects = false;
    act(() => useBuildWithAiStore.getState().openBuild(null));
    render(<BuildWithAiDialog />, { wrapper });
    await draftPlan();

    // Without project:update the new column and description are left out.
    expect(screen.queryByText("QA")).not.toBeInTheDocument();
    const [, secondTask] = screen.getAllByRole("button", {
      name: "ai:build.review.moveUp",
    });
    fireEvent.click(secondTask as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "ai:build.create" }));

    await screen.findByText("ai:build.done.partial");
    const [body] = applyBuild.mock.calls[0] as [
      { workspaceId: string; proposal: typeof PROPOSAL },
    ];
    expect(body.workspaceId).toBe("ws-1");
    expect(body.proposal.columns).toEqual([]);
    expect(body.proposal.project?.description).toBe("");
    expect(body.proposal.tasks.map((task) => task.title)).toEqual([
      "Ship homepage",
      "Audit pages",
    ]);
    expect(screen.getByText("Ship homepage")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "ai:build.openProject" }),
    );
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { workspaceId: "ws-1", projectId: "p-new" },
      }),
    );
  });

  it("builds into the project it was opened from", async () => {
    proposeBuild.mockResolvedValue({
      proposal: { ...PROPOSAL, project: null },
      target: { projectId: "p-1", projectName: "Website" },
      model: "m",
    });
    act(() => useBuildWithAiStore.getState().openBuild("p-1"));
    render(<BuildWithAiDialog />, { wrapper });
    expect(
      screen.getByRole("radio", { name: "ai:build.targetCurrent" }),
    ).toBeChecked();
    await draftPlan();
    expect(proposeBuild).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "p-1" }),
      expect.any(AbortSignal),
    );
  });

  describe("undo", () => {
    const REPORT = {
      projectId: "p-new",
      total: 3,
      done: 3,
      created: {
        project: true,
        columns: 0,
        cycles: 0,
        modules: 0,
        tasks: 2,
        subtasks: 0,
        labels: 0,
      },
      estimatesSkipped: false,
      failures: [],
      undoToken: "token-1",
    };
    const REMOVED = {
      project: true,
      columns: 0,
      cycles: 0,
      modules: 0,
      tasks: 0,
      subtasks: 0,
    };

    async function buildPlan(report: Record<string, unknown> = REPORT) {
      proposeBuild.mockResolvedValue({
        proposal: PROPOSAL,
        target: null,
        model: "m",
      });
      applyBuild.mockResolvedValue(report);
      act(() => useBuildWithAiStore.getState().openBuild(null));
      render(<BuildWithAiDialog />, { wrapper });
      await draftPlan();
      fireEvent.click(screen.getByRole("button", { name: /ai:build.create/ }));
      await screen.findByRole("button", { name: "ai:build.close" });
    }

    const undoButton = () =>
      screen.findByRole("button", { name: "ai:build.undo.button" });

    it("undoes the plan just created and stops offering to open it", async () => {
      undoBuild.mockResolvedValue({
        refused: false,
        result: { removed: REMOVED, archived: 0, failures: [] },
      });
      await buildPlan();
      expect(
        screen.getByRole("button", { name: "ai:build.openProject" }),
      ).toBeInTheDocument();

      fireEvent.click(await undoButton());

      expect(await screen.findByText("ai:build.undo.done")).toBeInTheDocument();
      expect(undoBuild).toHaveBeenCalledWith({
        workspaceId: "ws-1",
        undoToken: "token-1",
      });
      expect(
        screen.queryByRole("button", { name: "ai:build.undo.button" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "ai:build.openProject" }),
      ).not.toBeInTheDocument();
      expect(useBuildWithAiStore.getState().lastBuild).toBeNull();
    });

    it("offers no undo when nothing was created", async () => {
      await buildPlan({ ...REPORT, undoToken: undefined });
      expect(
        screen.queryByRole("button", { name: "ai:build.undo.button" }),
      ).not.toBeInTheDocument();
    });

    it("says what changed when it refuses, and keeps the plan", async () => {
      undoBuild.mockResolvedValue({
        refused: true,
        refusal: {
          code: "BUILD_EDITED",
          message: "Nothing was undone",
          items: [{ kind: "task", name: "Audit pages" }],
          total: 3,
        },
      });
      await buildPlan();
      fireEvent.click(await undoButton());

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "ai:build.undo.edited",
      );
      expect(screen.getByRole("alert")).toHaveTextContent("Audit pages");
      expect(screen.getByRole("alert")).toHaveTextContent("ai:build.undo.more");
      expect(
        screen.getByRole("button", { name: "ai:build.openProject" }),
      ).toBeInTheDocument();
      // It may be tried again once the edit is dealt with.
      expect(useBuildWithAiStore.getState().lastBuild).not.toBeNull();
    });

    it("lists what failed and keeps the token for a retry", async () => {
      undoBuild.mockResolvedValue({
        refused: false,
        result: {
          removed: { ...REMOVED, project: false, tasks: 1 },
          archived: 1,
          failures: [
            { kind: "module", name: "Content", status: 403, message: "No" },
          ],
        },
      });
      await buildPlan();
      fireEvent.click(await undoButton());

      expect(
        await screen.findByText("ai:build.undo.partial"),
      ).toBeInTheDocument();
      expect(screen.getByText("Content")).toBeInTheDocument();
      expect(screen.getByText("ai:build.undo.archived")).toBeInTheDocument();
      expect(useBuildWithAiStore.getState().lastBuild?.undoToken).toBe(
        "token-1",
      );
    });

    it("tells when the hour has passed", async () => {
      undoBuild.mockRejectedValue(new HttpError(410, "Undo has expired"));
      await buildPlan();
      fireEvent.click(await undoButton());
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "ai:build.undo.expired",
      );
      expect(useBuildWithAiStore.getState().lastBuild).toBeNull();
    });

    it("can still undo after closing the dialog to look at the result", async () => {
      undoBuild.mockResolvedValue({
        refused: false,
        result: { removed: REMOVED, archived: 0, failures: [] },
      });
      await buildPlan();
      fireEvent.click(screen.getByRole("button", { name: "ai:build.close" }));
      act(() => useBuildWithAiStore.getState().openBuild(null));

      expect(
        await screen.findByText("ai:build.undo.lastPlan"),
      ).toBeInTheDocument();
      fireEvent.click(await undoButton());
      expect(await screen.findByText("ai:build.undo.done")).toBeInTheDocument();
      expect(
        screen.queryByText("ai:build.undo.lastPlan"),
      ).not.toBeInTheDocument();
    });

    it("doesn't offer an undo from another workspace or past its hour", () => {
      for (const lastBuild of [
        {
          undoToken: "t",
          workspaceId: "ws-other",
          projectId: "p",
          expiresAt: Date.now() + 60_000,
        },
        {
          undoToken: "t",
          workspaceId: "ws-1",
          projectId: "p",
          expiresAt: Date.now() - 1,
        },
      ]) {
        act(() => {
          useBuildWithAiStore.getState().setLastBuild(lastBuild);
          useBuildWithAiStore.getState().openBuild(null);
        });
        render(<BuildWithAiDialog />, { wrapper });
        expect(
          screen.queryByText("ai:build.undo.lastPlan"),
        ).not.toBeInTheDocument();
        cleanup();
      }
    });
  });
});
