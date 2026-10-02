import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getStartedStorageKey } from "@/lib/get-started-storage";
import GetStarted from "./get-started";

const mocks = vi.hoisted(() => ({
  projects: [] as unknown[],
  members: [{ id: "m-1" }] as unknown[],
  can: { create: true, invite: true, manage: true },
  navigate: vi.fn(),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({ data: mocks.projects, isSuccess: true }),
}));
vi.mock("@/hooks/queries/workspace/use-get-full-workspace", () => ({
  default: () => ({ data: { members: mocks.members }, isSuccess: true }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canCreateProjects: () => mocks.can.create,
    canInviteUsers: () => mocks.can.invite,
    canManageWorkspace: () => mocks.can.manage,
  }),
}));
vi.mock("@/components/shared/modals/create-project-modal", () => ({
  default: () => null,
}));
vi.mock("@/components/team/invite-team-member-modal", () => ({
  default: () => null,
}));

beforeEach(() => {
  window.localStorage.clear();
  mocks.projects = [];
  mocks.members = [{ id: "m-1" }];
  mocks.can = { create: true, invite: true, manage: true };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("GetStarted", () => {
  it("lists every item for a new workspace and hides after Not now", () => {
    render(<GetStarted workspaceId="ws-1" />);
    expect(
      screen.getByText("home:getStarted.createProject.title"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("home:getStarted.configureWorkspace.title"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText("home:getStarted.dismiss"));
    expect(screen.queryByText("home:getStarted.title")).toBeNull();
    expect(
      JSON.parse(
        window.localStorage.getItem(getStartedStorageKey("ws-1")) ?? "{}",
      ).hidden,
    ).toBe(true);
  });

  it("stays hidden once dismissed", () => {
    window.localStorage.setItem(
      getStartedStorageKey("ws-1"),
      JSON.stringify({ hidden: true }),
    );
    render(<GetStarted workspaceId="ws-1" />);
    expect(screen.queryByText("home:getStarted.title")).toBeNull();
  });

  it("hides when the workspace has a project and two members", () => {
    mocks.projects = [{ id: "p-1" }];
    mocks.members = [{ id: "m-1" }, { id: "m-2" }];
    render(<GetStarted workspaceId="ws-1" />);
    expect(screen.queryByText("home:getStarted.title")).toBeNull();
  });

  it("hides items the user cannot act on and marks done ones", () => {
    mocks.can = { create: false, invite: false, manage: false };
    mocks.projects = [{ id: "p-1" }];
    render(<GetStarted workspaceId="ws-1" />);

    // A done item stays visible even without the capability.
    expect(
      screen.getByText("home:getStarted.createProject.title"),
    ).toBeInTheDocument();
    expect(screen.getByText("home:getStarted.done")).toBeInTheDocument();
    expect(screen.queryByText("home:getStarted.inviteTeam.title")).toBeNull();
    expect(
      screen.queryByText("home:getStarted.configureWorkspace.title"),
    ).toBeNull();
    expect(
      screen.getByText("home:getStarted.personalize.title"),
    ).toBeInTheDocument();
  });

  it("remembers the settings visit and navigates there", () => {
    render(<GetStarted workspaceId="ws-1" />);
    fireEvent.click(screen.getByText("home:getStarted.personalize.action"));
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/dashboard/settings/account/information",
    });
    expect(
      JSON.parse(
        window.localStorage.getItem(getStartedStorageKey("ws-1")) ?? "{}",
      ).visitedAccount,
    ).toBe(true);
  });
});
