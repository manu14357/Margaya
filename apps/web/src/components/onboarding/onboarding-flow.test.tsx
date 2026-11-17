import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readWorkspaceIntent } from "@/lib/create-flow-storage";
import { OnboardingFlow } from "./onboarding-flow";

const state = vi.hoisted(() => ({
  disabled: false,
  navigate: vi.fn(),
  createWorkspace: vi.fn(),
  submit: vi.fn(),
  applyStarter: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values && "count" in values ? `${key}:${values.count}` : key,
  }),
}));
// Steps swap at once: the motion itself is not under test here.
vi.mock("framer-motion", () => {
  const strip = ({
    children,
    initial: _i,
    animate: _a,
    exit: _e,
    variants: _v,
    transition: _t,
    onAnimationComplete: _c,
    ...rest
  }: Record<string, unknown> & { children?: ReactNode }) => ({
    children,
    rest,
  });
  const make =
    (Tag: "div" | "li" | "section") => (props: Record<string, unknown>) => {
      const { children, rest } = strip(props);
      const Element = Tag;
      return <Element {...(rest as object)}>{children}</Element>;
    };
  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
    motion: { div: make("div"), li: make("li"), section: make("section") },
    useReducedMotion: () => true,
  };
});
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => state.navigate,
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  default: () => ({ user: { id: "u1" } }),
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({ data: { user: { role: "user" } } }),
    organization: { setActive: vi.fn().mockResolvedValue({}) },
  },
}));
vi.mock("@/hooks/queries/config/use-get-config", () => ({
  default: () => ({ data: { disableWorkspaceCreation: state.disabled } }),
}));
vi.mock("@/hooks/queries/invitation/use-pending-invitations", () => ({
  usePendingInvitations: () => ({
    data: [],
    isFetching: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/queries/workspace/use-create-workspace", () => ({
  default: () => ({ mutateAsync: state.createWorkspace, isPending: false }),
}));
vi.mock("@/hooks/use-locale", () => ({
  useLocale: () => ({ locale: "en-US" }),
}));

const summary = (id: string, name: string, categories: string[]) => ({
  id,
  version: 1,
  categories,
  featured: true,
  icon: "Layout",
  name,
  pitch: `${name} pitch`,
  description: "",
  suggestedKey: id.slice(0, 3).toUpperCase(),
  suggestedVisibility: "open",
  counts: {
    statuses: 4,
    labels: 0,
    customFields: 0,
    views: 0,
    automationRules: 0,
    taskTemplates: 0,
    pages: 0,
    whiteboards: 0,
    modules: 0,
    sampleTasks: 5,
  },
  hasSampleData: true,
});

vi.mock("@/hooks/queries/project-template/use-project-templates", () => ({
  useProjectTemplates: () => ({
    data: {
      revision: "r",
      locale: "en-US",
      categories: [
        {
          id: "software-development",
          icon: "Code",
          name: "Software",
          description: "",
        },
        { id: "work-management", icon: "List", name: "Work", description: "" },
      ],
      templates: [
        summary("kanban", "Kanban board", ["software-development"]),
        summary("scrum", "Sprints", ["software-development"]),
        summary("project-management", "Projects", ["work-management"]),
      ],
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useProjectTemplate: () => ({ data: undefined }),
  useWorkspaceStarters: () => ({
    data: [
      {
        id: "software-team",
        version: 1,
        icon: "Code",
        name: "Software team",
        description: "Sprints, bugs and a roadmap.",
        projects: [
          {
            templateId: "scrum",
            key: "SPR",
            name: "Sprints",
            icon: "Code",
            visibility: "open",
          },
          {
            templateId: "kanban",
            key: "KAN",
            name: "Flow",
            icon: "Code",
            visibility: "open",
          },
        ],
      },
    ],
  }),
}));
vi.mock("@/components/create-project/use-submit-project", () => ({
  useSubmitProject: () => ({ submit: state.submit, isPending: false }),
}));
vi.mock(
  "@/hooks/mutations/project-template/use-apply-workspace-starter",
  () => ({
    useApplyWorkspaceStarter: () => ({
      mutateAsync: state.applyStarter,
      isPending: false,
    }),
  }),
);
vi.mock("@/hooks/mutations/workspace-user/use-invite-workspace-user", () => ({
  default: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/queries/workspace/use-grantable-roles", () => ({
  default: () => ({ roles: ["member"] }),
}));
vi.mock("@/components/project-templates/template-art", () => ({
  TemplateArt: () => null,
  preloadTemplateArt: vi.fn(),
}));
vi.mock("@/components/create-project/project-icon-picker", () => ({
  ProjectIconPicker: () => null,
}));
vi.mock("@/components/common/logo", () => ({ Logo: () => null }));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/components/invitation/pending-invitation-list", () => ({
  PendingInvitationList: () => null,
}));
vi.mock("@/components/team/invitation-link-field", () => ({
  default: () => null,
}));
vi.mock("@/components/team/invite-failure-list", () => ({
  default: () => null,
}));
vi.mock("@/components/team/invite-role-select", () => ({
  default: () => null,
}));

beforeEach(() => {
  state.disabled = false;
  state.navigate.mockReset();
  state.createWorkspace.mockReset().mockResolvedValue({ id: "w1" });
  state.submit.mockReset().mockResolvedValue({
    ok: true,
    project: { id: "p1", name: "Kanban board" },
    sampleTaskCount: 5,
    firstSteps: true,
  });
  state.applyStarter.mockReset().mockResolvedValue({
    projects: [
      { id: "p1", name: "Sprints", template: { sampleTaskCount: 0 } },
      { id: "p2", name: "Flow", template: { sampleTaskCount: 0 } },
    ],
  });
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

async function createWorkspace(intentLabel?: string) {
  fireEvent.change(screen.getByLabelText("auth:onboarding.workspaceName"), {
    target: { value: "Acme" },
  });
  if (intentLabel)
    fireEvent.click(screen.getByRole("button", { name: intentLabel }));
  fireEvent.click(
    screen.getByRole("button", { name: /auth:onboarding.createWorkspace/ }),
  );
  await screen.findByRole("heading", { name: /auth:onboarding.projectTitle/ });
}

describe("OnboardingFlow", () => {
  it("asks for a name before creating the workspace", () => {
    render(<OnboardingFlow />);
    // The heading carries the visually hidden step prefix.
    expect(
      screen.getByRole("heading", {
        name: /auth:onboarding.nameWorkspaceTitle/,
      }),
    ).toHaveTextContent(
      /^auth:onboarding.stepPrefix\s*auth:onboarding.nameWorkspaceTitle$/,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /auth:onboarding.createWorkspace/ }),
    );
    expect(
      screen.getByText("auth:onboarding.validation.workspaceNameRequired"),
    ).toBeInTheDocument();
    expect(state.createWorkspace).not.toHaveBeenCalled();
  });

  it("keeps the intent in the browser only and moves to the first project", async () => {
    render(<OnboardingFlow />);
    const chip = screen.getByRole("button", {
      name: "auth:onboarding.intent.software",
    });
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "false");
    await createWorkspace("auth:onboarding.intent.software");
    expect(state.createWorkspace).toHaveBeenCalledWith({
      name: "Acme",
      description: "",
      userId: "u1",
    });
    expect(readWorkspaceIntent("w1")).toBe("software-development");
  });

  it("creates the first project from a template with example tasks on", async () => {
    render(<OnboardingFlow />);
    await createWorkspace("auth:onboarding.intent.software");
    const radios = screen.getAllByRole("radio", { name: /pitch|blankName/ });
    expect(radios[0]).toHaveTextContent(
      "common:modals.createProject.choose.blankName",
    );
    fireEvent.click(screen.getByRole("radio", { name: /Sprints/ }));
    expect(
      screen.getByLabelText("common:modals.createProject.projectName"),
    ).toHaveValue("Sprints");
    expect(
      screen.getByRole("switch", {
        name: "common:modals.createProject.setup.examples",
      }),
    ).toBeChecked();
    fireEvent.click(
      screen.getByRole("button", { name: /auth:onboarding.createProject$/ }),
    );
    await waitFor(() => expect(state.submit).toHaveBeenCalled());
    expect(state.submit.mock.calls[0][0]).toMatchObject({
      name: "Sprints",
      workspaceId: "w1",
      template: { id: "scrum", sampleData: true, locale: "en-US" },
    });
    await screen.findByRole("heading", {
      name: /auth:onboarding.inviteTitle/,
    });
    fireEvent.click(
      screen.getByRole("button", { name: "auth:onboarding.skip" }),
    );
    await screen.findByRole("heading", { name: "auth:onboarding.done.title" });
    fireEvent.click(
      screen.getByRole("button", { name: /auth:onboarding.done.open/ }),
    );
    expect(state.navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { workspaceId: "w1", projectId: "p1" },
        replace: true,
      }),
    );
  });

  it("creates a starter set in one request", async () => {
    render(<OnboardingFlow />);
    await createWorkspace();
    fireEvent.click(screen.getByRole("button", { name: /Software team/ }));
    expect(
      screen.getByText("Sprints, bugs and a roadmap."),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "auth:onboarding.createProjects:2" }),
    );
    await waitFor(() => expect(state.applyStarter).toHaveBeenCalled());
    expect(state.applyStarter.mock.calls[0][0]).toMatchObject({
      workspaceId: "w1",
      starterId: "software-team",
      sampleData: false,
    });
    await screen.findByRole("heading", {
      name: /auth:onboarding.inviteTitle/,
    });
  });

  it("goes back to a summary instead of creating the workspace twice", async () => {
    render(<OnboardingFlow />);
    await createWorkspace();
    fireEvent.click(
      screen.getByRole("button", { name: "auth:onboarding.back" }),
    );
    expect(
      await screen.findByText("auth:onboarding.workspaceCreatedTitle"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /auth:onboarding.continue/ }),
    );
    await screen.findByRole("heading", {
      name: /auth:onboarding.projectTitle/,
    });
    expect(state.createWorkspace).toHaveBeenCalledTimes(1);
  });

  it("waits for an invitation when the server does not allow creating workspaces", () => {
    state.disabled = true;
    render(<OnboardingFlow />);
    expect(
      screen.getByText("auth:onboarding.waiting.title"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("auth:onboarding.workspaceName")).toBeNull();
  });
});
