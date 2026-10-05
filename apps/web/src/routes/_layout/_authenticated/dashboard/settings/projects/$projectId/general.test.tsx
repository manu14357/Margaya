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
  error: vi.fn(),
  project: {
    id: "p1",
    workspaceId: "w1",
    name: "Old name",
    slug: "OLD",
    description: "",
    icon: "Layout",
    isPublic: true,
  } as Record<string, unknown>,
}));

vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useNavigate: () => vi.fn(),
  useParams: () => ({ projectId: "p1" }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/components/project/tasks-import-export.tsx", () => ({
  TasksImportExport: () => null,
}));
vi.mock("@/hooks/queries/task/use-get-tasks", () => ({
  // The board query keeps returning the snapshot from page load.
  useGetTasks: () => ({ data: m.project }),
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "w1" } }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canManageProjects: () => true,
    canDeleteProjects: () => false,
    canUpdateProjects: () => false,
  }),
}));
vi.mock("@/components/archives/archive-project-setting", () => ({
  default: () => null,
}));
vi.mock("@/hooks/mutations/project/use-update-project", () => ({
  default: () => ({ mutateAsync: m.update }),
}));
vi.mock("@/hooks/mutations/project/use-delete-project", () => ({
  default: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/components/project/project-people-settings", () => ({
  default: () => null,
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: m.success, error: m.error },
}));

const Component = Route.options.component as ComponentType;

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  m.update.mockImplementation(async (payload: Record<string, unknown>) => ({
    ...payload,
    workspaceId: "w1",
  }));
});

const input = (placeholder: string) =>
  screen.getByPlaceholderText(`settings:projectGeneral.${placeholder}`);

describe("project general settings", () => {
  it("keeps an earlier rename when a later field is saved", async () => {
    render(<Component />);

    fireEvent.change(input("projectNamePlaceholder"), {
      target: { value: "New name" },
    });
    await waitFor(() => expect(m.update).toHaveBeenCalledTimes(1), {
      timeout: 3000,
    });
    expect(m.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "p1", name: "New name", isPublic: true }),
    );
    await act(async () => {});

    fireEvent.change(input("descriptionPlaceholder"), {
      target: { value: "Now with a description" },
    });
    await waitFor(() => expect(m.update).toHaveBeenCalledTimes(2), {
      timeout: 3000,
    });
    expect(m.update).toHaveBeenLastCalledWith({
      id: "p1",
      name: "New name",
      slug: "OLD",
      description: "Now with a description",
      icon: "Layout",
      isPublic: true,
    });
    expect(input("projectNamePlaceholder")).toHaveValue("New name");
  });
});
