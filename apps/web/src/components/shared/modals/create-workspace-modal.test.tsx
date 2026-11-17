import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readWorkspaceDraft,
  readWorkspaceIntent,
} from "@/lib/create-flow-storage";
import CreateWorkspaceModal from "./create-workspace-modal";

const state = vi.hoisted(() => ({
  create: vi.fn(),
  navigate: vi.fn(),
  projectFlow: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));
vi.mock("framer-motion", () => ({
  motion: {
    div: ({
      children,
      initial: _i,
      animate: _a,
      transition: _t,
      ...rest
    }: Record<string, unknown> & { children?: ReactNode }) => (
      <div {...(rest as object)}>{children}</div>
    ),
  },
  useReducedMotion: () => true,
}));
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
  authClient: { organization: { setActive: vi.fn().mockResolvedValue({}) } },
}));
vi.mock("@/hooks/queries/workspace/use-create-workspace", () => ({
  default: () => ({ mutateAsync: state.create, isPending: false }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canCreateProjects: () => true,
    canInviteUsers: () => true,
  }),
}));
vi.mock("@/components/shared/modals/create-project-modal", () => ({
  default: (props: { open: boolean; intent?: string | null }) => {
    if (props.open) state.projectFlow(props);
    return null;
  },
}));
vi.mock("@/components/team/invite-team-member-modal", () => ({
  default: () => null,
}));

beforeEach(() => {
  state.create.mockReset().mockResolvedValue({ id: "w2" });
  state.navigate.mockReset();
  state.projectFlow.mockReset();
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("CreateWorkspaceModal", () => {
  it("creates the workspace, then offers the next steps", async () => {
    const onClose = vi.fn();
    render(<CreateWorkspaceModal open onClose={onClose} />);
    fireEvent.change(
      screen.getByRole("textbox", { name: "auth:onboarding.workspaceName" }),
      { target: { value: "Acme" } },
    );
    fireEvent.click(screen.getByText("auth:onboarding.intent.legend"));
    fireEvent.click(
      screen.getByRole("button", { name: "auth:onboarding.intent.marketing" }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "common:modals.createWorkspace.createButton",
      }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "common:modals.createWorkspace.ready.title",
      }),
    ).toBeInTheDocument();
    expect(state.create).toHaveBeenCalledWith({
      name: "Acme",
      description: "",
    });
    expect(readWorkspaceIntent("w2")).toBe("marketing");
    expect(state.navigate).toHaveBeenCalledWith(
      expect.objectContaining({ params: { workspaceId: "w2" } }),
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /common:modals.createWorkspace.ready.project/,
      }),
    );
    expect(onClose).toHaveBeenCalled();
    expect(state.projectFlow).toHaveBeenCalledWith(
      expect.objectContaining({ open: true, intent: "marketing" }),
    );
  });

  it("refuses an empty name", () => {
    render(<CreateWorkspaceModal open onClose={vi.fn()} />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "common:modals.createWorkspace.createButton",
      }),
    );
    expect(
      screen.getByText("auth:onboarding.validation.workspaceNameRequired"),
    ).toBeInTheDocument();
    expect(state.create).not.toHaveBeenCalled();
  });

  it("keeps a draft on cancel", () => {
    render(<CreateWorkspaceModal open onClose={vi.fn()} />);
    fireEvent.change(
      screen.getByRole("textbox", { name: "auth:onboarding.workspaceName" }),
      { target: { value: "Half" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "common:actions.cancel" }),
    );
    expect(readWorkspaceDraft("u1")).toMatchObject({ name: "Half" });
  });

  it("stays a plain form for the instance admin", async () => {
    const onClose = vi.fn();
    render(<CreateWorkspaceModal open simple onClose={onClose} />);
    expect(screen.queryByText("auth:onboarding.intent.legend")).toBeNull();
    fireEvent.change(
      screen.getByRole("textbox", { name: "auth:onboarding.workspaceName" }),
      { target: { value: "For someone" } },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "common:modals.createWorkspace.createButton",
      }),
    );
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(
      screen.queryByText("common:modals.createWorkspace.ready.title"),
    ).toBeNull();
  });
});
