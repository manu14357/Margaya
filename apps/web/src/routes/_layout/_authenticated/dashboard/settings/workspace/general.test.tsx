import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "./general";

const m = vi.hoisted(() => ({
  update: vi.fn(),
  success: vi.fn(),
  workspace: { id: "w1", name: "Acme", description: "" } as {
    id: string;
    name: string;
    description: string;
  },
}));

vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useNavigate: () => vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  default: () => ({ user: { id: "u1" } }),
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: m.workspace }),
}));
vi.mock("@/hooks/queries/workspace/use-get-full-workspace", () => ({
  default: () => ({ data: { members: [] } }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canManageWorkspace: () => true,
    canDeleteWorkspace: () => false,
    isOwner: () => false,
  }),
}));
vi.mock("@/hooks/mutations/workspace/use-update-workspace", () => ({
  default: () => ({ mutateAsync: m.update }),
}));
vi.mock("@/hooks/mutations/workspace/use-delete-workspace", () => ({
  default: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/mutations/workspace/use-leave-workspace", () => ({
  default: () => ({ mutateAsync: vi.fn(), isPending: false }),
  LAST_OWNER_CODE: "YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER",
  LeaveWorkspaceError: class extends Error {},
}));
vi.mock("@/hooks/mutations/workspace/use-transfer-workspace-ownership", () => ({
  default: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/components/settings/workspace-timezone-setting", () => ({
  default: () => null,
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: m.success, error: vi.fn() },
}));

const Component = Route.options.component as ComponentType;
const nameInput = () =>
  screen.getByPlaceholderText("settings:workspaceGeneral.namePlaceholder");
const descriptionInput = () =>
  screen.getByPlaceholderText(
    "settings:workspaceGeneral.descriptionPlaceholder",
  );

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  m.workspace = { id: "w1", name: "Acme", description: "" };
  m.update.mockResolvedValue({});
});

describe("workspace general settings autosave", () => {
  it("saves a name replaced in one step", async () => {
    render(<Component />);
    fireEvent.change(nameInput(), { target: { value: "Pasted name" } });

    await waitFor(() => expect(m.success).toHaveBeenCalled(), {
      timeout: 3000,
    });
    expect(m.update).toHaveBeenCalledWith({
      workspaceId: "w1",
      name: "Pasted name",
    });
  });

  it("saves once a single change fixes a validation error", async () => {
    render(<Component />);
    fireEvent.change(nameInput(), { target: { value: "A" } });
    fireEvent.change(nameInput(), { target: { value: "Valid name" } });

    await waitFor(() => expect(m.update).toHaveBeenCalledTimes(1), {
      timeout: 3000,
    });
    expect(m.update).toHaveBeenCalledWith({
      workspaceId: "w1",
      name: "Valid name",
    });
  });

  it("ignores a stale workspace response that arrives after a save", async () => {
    const { rerender } = render(<Component />);
    fireEvent.change(nameInput(), { target: { value: "Renamed" } });
    await waitFor(() => expect(m.success).toHaveBeenCalled(), {
      timeout: 3000,
    });

    // A request sent before the save resolves late with the old name.
    m.workspace = { id: "w1", name: "Acme", description: "" };
    rerender(<Component />);
    await act(async () => {});
    expect(nameInput()).toHaveValue("Renamed");

    fireEvent.change(descriptionInput(), { target: { value: "About us" } });
    await waitFor(() => expect(m.update).toHaveBeenCalledTimes(2), {
      timeout: 3000,
    });
    expect(m.update).toHaveBeenLastCalledWith({
      workspaceId: "w1",
      description: "About us",
    });
    expect(nameInput()).toHaveValue("Renamed");
  });
});
