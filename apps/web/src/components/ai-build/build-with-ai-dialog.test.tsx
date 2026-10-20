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
vi.mock("@/fetchers/ai/build", () => ({
  proposeBuild: (...args: unknown[]) => proposeBuild(...args),
  applyBuild: (...args: unknown[]) => applyBuild(...args),
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
  navigate.mockReset();
  act(() => useBuildWithAiStore.getState().close());
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
});
