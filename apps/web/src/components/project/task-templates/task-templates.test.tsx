import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TaskTemplates from "./task-templates";

const m = vi.hoisted(() => ({
  canUpdate: true,
  templates: [] as Array<Record<string, unknown>>,
  remove: vi.fn(),
  success: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && "name" in options ? `${key}:${options.name}` : key,
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "w1" } }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canUpdateProjects: () => m.canUpdate,
    isCheckingPermissions: false,
  }),
}));
vi.mock("@/hooks/queries/task-template/use-task-templates", () => ({
  useTaskTemplates: () => ({
    data: m.templates,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/mutations/task-template/use-delete-task-template", () => ({
  useDeleteTaskTemplate: () => ({ mutateAsync: m.remove }),
}));
// The dialog has its own data needs; the list only opens it.
vi.mock("./task-template-dialog", () => ({
  default: ({ open, template }: { open: boolean; template: unknown }) =>
    open ? <div role="dialog">{template ? "editing" : "creating"}</div> : null,
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: m.success, error: vi.fn() },
}));

function template(overrides: Record<string, unknown> = {}) {
  return {
    id: "t1",
    projectId: "p1",
    name: "Bug report",
    titlePattern: "Bug: {title}",
    description: "",
    columnId: "c1",
    column: { id: "c1", name: "Review", slug: "review" },
    priority: null,
    labels: [],
    assigneeIds: [],
    estimatePointId: null,
    subtasks: ["Reproduce", "Fix"],
    position: 0,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  m.canUpdate = true;
  m.templates = [];
  m.remove.mockResolvedValue({ id: "t1" });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TaskTemplates", () => {
  it("shows a quiet empty state and the add action", () => {
    render(<TaskTemplates projectId="p1" />);
    expect(screen.getByText("templates:settings.empty")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "templates:settings.add" }),
    );
    expect(screen.getByRole("dialog").textContent).toBe("creating");
  });

  it("lists templates with a summary and opens one for editing", () => {
    m.templates = [template()];
    render(<TaskTemplates projectId="p1" />);
    expect(screen.getByText("Bug report")).toBeTruthy();
    expect(
      screen.getByText(
        "Bug: {title} · Review · templates:settings.subtaskCount",
      ),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: "templates:settings.editAria:Bug report",
      }),
    );
    expect(screen.getByRole("dialog").textContent).toBe("editing");
  });

  it("deletes a template after confirming", async () => {
    m.templates = [template()];
    render(<TaskTemplates projectId="p1" />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "templates:settings.deleteAria:Bug report",
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "templates:settings.deleteConfirm",
      }),
    );
    await waitFor(() =>
      expect(m.remove).toHaveBeenCalledWith({
        workspaceId: "w1",
        projectId: "p1",
        id: "t1",
      }),
    );
    expect(m.success).toHaveBeenCalledWith("templates:settings.toast.deleted");
  });

  it("is read-only without project:update", () => {
    m.canUpdate = false;
    m.templates = [template()];
    render(<TaskTemplates projectId="p1" />);
    expect(screen.getByText("Bug report")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "templates:settings.add" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: "templates:settings.editAria:Bug report",
      }),
    ).toBeNull();
    expect(screen.getByText("templates:settings.noPermission")).toBeTruthy();
  });
});
