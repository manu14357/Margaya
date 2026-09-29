import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExportFormDialog } from "./export-form-dialog";

const m = vi.hoisted(() => ({
  projects: [] as unknown[],
  mutate: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/queries/task-export/use-export-projects", () => ({
  useExportProjects: () => ({ data: m.projects, isLoading: false }),
}));
vi.mock("@/hooks/mutations/task-export/use-create-task-export", () => ({
  useCreateTaskExport: () => ({ mutate: m.mutate, isPending: false }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: m.success, error: m.error },
}));

function project(id: string, archivedAt: string | null = null) {
  return { id, name: `Project ${id}`, icon: "Layout", archivedAt };
}

function renderDialog(onOpenChange = vi.fn()) {
  render(
    <ExportFormDialog open onOpenChange={onOpenChange} workspaceId="ws-1" />,
  );
  return onOpenChange;
}

function splitSwitch() {
  return screen.getByRole("switch", {
    name: "settings:workspaceExports.form.split",
  });
}

describe("ExportFormDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(cleanup);

  it("disables one file per project when All projects covers one", () => {
    m.projects = [project("a"), project("b", "2026-09-01T00:00:00.000Z")];
    renderDialog();

    expect(splitSwitch()).toHaveAttribute("aria-disabled", "true");
  });

  it("allows one file per project when All projects covers two", () => {
    m.projects = [project("a"), project("b")];
    renderDialog();

    expect(splitSwitch()).not.toHaveAttribute("aria-disabled", "true");
  });

  it("starts an export of every project with the defaults", () => {
    m.projects = [project("a"), project("b")];
    m.mutate.mockImplementation((_input, options) => options.onSuccess());
    const onOpenChange = renderDialog();

    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:workspaceExports.form.submit",
      }),
    );

    expect(m.mutate).toHaveBeenCalledWith(
      {
        workspaceId: "ws-1",
        format: "csv",
        projectIds: undefined,
        splitByProject: false,
        includeArchived: true,
      },
      expect.any(Object),
    );
    expect(m.success).toHaveBeenCalledWith(
      "settings:workspaceExports.toast.started",
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows the server's reason when the export can't start", () => {
    m.projects = [project("a")];
    m.mutate.mockImplementation((_input, options) =>
      options.onError(
        new Error(
          "You already have 3 exports in progress. Wait for one to finish.",
        ),
      ),
    );
    const onOpenChange = renderDialog();

    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:workspaceExports.form.submit",
      }),
    );

    expect(m.error).toHaveBeenCalledWith(
      "You already have 3 exports in progress. Wait for one to finish.",
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
