import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeFirstSteps } from "@/lib/create-flow-storage";
import ProjectFirstSteps from "./project-first-steps";

const state = vi.hoisted(() => ({
  canDeleteTasks: false,
  mutate: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values && "done" in values
        ? `${key}:${values.done}/${values.total}`
        : key,
  }),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canDeleteTasks: () => state.canDeleteTasks,
    canCreateTasks: () => true,
    canInviteUsers: () => true,
    isCheckingPermissions: false,
  }),
}));
vi.mock("@/hooks/mutations/project-template/use-remove-sample-data", () => ({
  useRemoveSampleData: () => ({ mutate: state.mutate, isPending: false }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: state.toastSuccess, error: vi.fn() },
}));
vi.mock("@/components/shared/modals/lazy-create-task-modal", () => ({
  default: () => null,
}));
vi.mock("@/components/team/invite-team-member-modal", () => ({
  default: () => null,
}));

const project = (hasSampleData: boolean) => ({
  id: "p1",
  workspaceId: "w1",
  name: "Support",
  hasSampleData,
});

beforeEach(() => {
  state.canDeleteTasks = false;
  state.mutate.mockReset();
  state.toastSuccess.mockReset();
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("ProjectFirstSteps", () => {
  it("renders nothing for a project this browser did not create", () => {
    const { container } = render(
      <ProjectFirstSteps project={project(false)} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("hides the examples banner from people who may not remove them", () => {
    render(<ProjectFirstSteps project={project(true)} />);
    expect(
      screen.queryByText("common:modals.createProject.examples.banner"),
    ).toBeNull();
  });

  it("shows the banner with task:delete and removes the examples after confirming", async () => {
    state.canDeleteTasks = true;
    state.mutate.mockImplementation((_vars, options) =>
      options.onSuccess({ removedTaskCount: 6, trashBatchId: "b1" }),
    );
    render(<ProjectFirstSteps project={project(true)} />);
    expect(
      screen.getByText("common:modals.createProject.examples.banner"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "common:modals.createProject.firstSteps.removeExamples",
      }),
    );
    const confirm = await screen.findByRole("alertdialog");
    expect(confirm).toHaveTextContent(
      "common:modals.createProject.examples.confirmBody",
    );
    fireEvent.click(
      within(confirm).getByRole("button", {
        name: "common:modals.createProject.firstSteps.removeExamples",
      }),
    );
    expect(state.mutate).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(state.toastSuccess).toHaveBeenCalledWith(
        "common:modals.createProject.examples.removed",
        expect.objectContaining({
          description: "common:modals.createProject.examples.restoreHint",
        }),
      ),
    );
  });

  it("lets the person who added the examples remove them without task:delete", () => {
    writeFirstSteps("p1", {
      projectName: "Support",
      sampleTaskCount: 6,
      appliedByMe: true,
      dismissed: true,
    });
    render(<ProjectFirstSteps project={project(true)} />);
    expect(
      screen.getByText("common:modals.createProject.examples.banner"),
    ).toBeInTheDocument();
  });

  it("offers removal once: in the open first-steps strip, not also in the banner", () => {
    writeFirstSteps("p1", {
      projectName: "Support",
      sampleTaskCount: 6,
      appliedByMe: true,
    });
    render(<ProjectFirstSteps project={project(true)} />);
    expect(
      screen.queryByText("common:modals.createProject.examples.banner"),
    ).toBeNull();
    expect(
      screen.getByRole("region", {
        name: "common:modals.createProject.firstSteps.label",
      }),
    ).toBeInTheDocument();
  });

  it("dismisses the banner and keeps it dismissed", () => {
    state.canDeleteTasks = true;
    const { unmount } = render(<ProjectFirstSteps project={project(true)} />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "common:modals.createProject.examples.dismissBanner",
      }),
    );
    expect(
      screen.queryByText("common:modals.createProject.examples.banner"),
    ).toBeNull();
    unmount();
    render(<ProjectFirstSteps project={project(true)} />);
    expect(
      screen.queryByText("common:modals.createProject.examples.banner"),
    ).toBeNull();
  });

  it("shows at most four first steps and ticks them off", () => {
    writeFirstSteps("p1", {
      projectName: "Support",
      sampleTaskCount: 6,
      appliedByMe: true,
    });
    render(<ProjectFirstSteps project={project(true)} />);
    const strip = screen.getByRole("region", {
      name: "common:modals.createProject.firstSteps.label",
    });
    expect(strip.querySelectorAll("li")).toHaveLength(4);
    expect(strip).toHaveTextContent(
      "common:modals.createProject.firstSteps.progress:0/4",
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "common:modals.createProject.firstSteps.markDone",
      }),
    );
    expect(strip).toHaveTextContent(
      "common:modals.createProject.firstSteps.progress:1/4",
    );
  });

  it("dismisses the strip", () => {
    writeFirstSteps("p1", { projectName: "Support", sampleTaskCount: 0 });
    render(<ProjectFirstSteps project={project(false)} />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "common:modals.createProject.firstSteps.dismiss",
      }),
    );
    expect(
      screen.queryByRole("region", {
        name: "common:modals.createProject.firstSteps.label",
      }),
    ).toBeNull();
  });
});
