import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Estimate } from "@/types/estimate";
import EstimateSettings from "./estimate-settings";
import { makeEstimate, testTranslate } from "./test-fixtures";

type ListState = {
  data?: { activeEstimateId: string | null; estimates: Estimate[] };
  isLoading?: boolean;
  isError?: boolean;
};

const state = vi.hoisted(() => ({
  canUpdateProjects: true,
  list: {} as ListState,
  refetch: vi.fn(),
  onCreated: null as ((estimate: Estimate) => void) | null,
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: testTranslate }),
}));

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canUpdateProjects: () => state.canUpdateProjects,
  }),
}));

vi.mock("@/hooks/queries/estimate/use-get-estimates", () => ({
  useGetEstimates: () => ({ ...state.list, refetch: state.refetch }),
}));

// The children have their own tests; here they only report what they get.
vi.mock("./estimate-system-card", () => ({
  default: ({ estimate }: { estimate: Estimate }) => (
    <div>card {estimate.name}</div>
  ),
}));
vi.mock("./create-estimate-dialog", () => ({
  default: (props: { onCreated: (estimate: Estimate) => void }) => {
    state.onCreated = props.onCreated;
    return null;
  },
}));
vi.mock("./switch-estimate-dialog", () => ({
  default: ({
    current,
    target,
  }: {
    current: Estimate | null;
    target: Estimate;
  }) => (
    <div>
      switch {current?.name ?? "none"} to {target.name}
    </div>
  ),
}));
vi.mock("./delete-estimate-dialog", () => ({ default: () => null }));
vi.mock("@/components/insight/estimate-calibration-card", () => ({
  default: () => null,
}));

afterEach(() => {
  cleanup();
  state.canUpdateProjects = true;
  state.list = {};
  state.onCreated = null;
  state.refetch.mockReset();
});

const active = makeEstimate("points", ["1", "2"], {
  id: "active",
  name: "Fibonacci",
});
const older = makeEstimate("categories", ["S", "L"], {
  id: "older",
  name: "Sizes",
  isActive: false,
});

describe("EstimateSettings", () => {
  it("shows skeleton rows while loading", () => {
    state.list = { isLoading: true };
    const { container } = render(<EstimateSettings projectId="project-1" />);
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(
      3,
    );
  });

  it("offers a retry when loading fails", () => {
    state.list = { isError: true };
    render(<EstimateSettings projectId="project-1" />);
    screen
      .getByRole("button", { name: "settings:projectEstimates.retry" })
      .click();
    expect(state.refetch).toHaveBeenCalled();
  });

  it("shows the empty state, with the action for admins only", () => {
    state.list = { data: { activeEstimateId: null, estimates: [] } };
    render(<EstimateSettings projectId="project-1" />);
    expect(
      screen.getByText("settings:projectEstimates.empty.title"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "settings:projectEstimates.empty.action",
      }),
    ).toBeInTheDocument();

    cleanup();
    state.canUpdateProjects = false;
    render(<EstimateSettings projectId="project-1" />);
    expect(
      screen.queryByRole("button", {
        name: "settings:projectEstimates.empty.action",
      }),
    ).toBeNull();
    expect(
      screen.getByText("settings:projectEstimates.readOnly"),
    ).toBeInTheDocument();
  });

  it("shows the active system and the ones used before", () => {
    state.list = {
      data: { activeEstimateId: "active", estimates: [active, older] },
    };
    render(<EstimateSettings projectId="project-1" />);
    expect(screen.getByText("card Fibonacci")).toBeInTheDocument();
    expect(
      screen.getByText("settings:projectEstimates.otherTitle"),
    ).toBeInTheDocument();
    expect(screen.getByText("Sizes")).toBeInTheDocument();
  });

  it("notes when no system is active", () => {
    state.list = { data: { activeEstimateId: null, estimates: [older] } };
    render(<EstimateSettings projectId="project-1" />);
    expect(
      screen.getByText("settings:projectEstimates.noActiveTitle"),
    ).toBeInTheDocument();
  });

  it("opens the switch dialog for a system created beside an active one", () => {
    const created = makeEstimate("time", ["30", "60"], {
      id: "created",
      name: "Hours",
      isActive: false,
    });
    state.list = {
      data: { activeEstimateId: "active", estimates: [active, created] },
    };
    render(<EstimateSettings projectId="project-1" />);
    act(() => state.onCreated?.(created));
    expect(screen.getByText("switch Fibonacci to Hours")).toBeInTheDocument();
  });

  it("doesn't switch after creating the project's first system", () => {
    state.list = { data: { activeEstimateId: "active", estimates: [active] } };
    render(<EstimateSettings projectId="project-1" />);
    act(() => state.onCreated?.(active));
    expect(screen.queryByText(/^switch/)).toBeNull();
  });
});
