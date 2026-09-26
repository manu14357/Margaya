import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProjectFeatureGate from "./project-feature-gate";

const mocks = vi.hoisted(() => ({
  useProjectFeatures: vi.fn(),
  canUpdateProjects: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: { children?: unknown }) => (
    <a href="/features" {...props}>
      {children as never}
    </a>
  ),
}));
vi.mock("@/hooks/use-project-features", () => ({
  useProjectFeatures: () => mocks.useProjectFeatures(),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canUpdateProjects: mocks.canUpdateProjects,
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderGate() {
  return render(
    <ProjectFeatureGate projectId="p1" workspaceId="w1" feature="timeTracking">
      <p>section content</p>
    </ProjectFeatureGate>,
  );
}

describe("ProjectFeatureGate", () => {
  it("shows a skeleton while the project loads", () => {
    mocks.useProjectFeatures.mockReturnValue({
      isLoading: true,
      isEnabled: () => false,
    });
    const { container } = renderGate();
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(screen.queryByText("section content")).toBeNull();
  });

  it("offers managers a way to turn the feature on", () => {
    mocks.useProjectFeatures.mockReturnValue({
      isLoading: false,
      isEnabled: () => false,
    });
    mocks.canUpdateProjects.mockReturnValue(true);
    renderGate();
    expect(
      screen.getByText("common:featureDisabled.title"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("common:featureDisabled.manage"),
    ).toBeInTheDocument();
    expect(screen.queryByText("section content")).toBeNull();
  });

  it("tells everyone else to ask a manager", () => {
    mocks.useProjectFeatures.mockReturnValue({
      isLoading: false,
      isEnabled: () => false,
    });
    mocks.canUpdateProjects.mockReturnValue(false);
    renderGate();
    expect(
      screen.getByText("common:featureDisabled.askAdmin"),
    ).toBeInTheDocument();
    expect(screen.queryByText("common:featureDisabled.manage")).toBeNull();
  });

  it("renders the section when the feature is on", () => {
    mocks.useProjectFeatures.mockReturnValue({
      isLoading: false,
      isEnabled: () => true,
    });
    renderGate();
    expect(screen.getByText("section content")).toBeInTheDocument();
  });
});
