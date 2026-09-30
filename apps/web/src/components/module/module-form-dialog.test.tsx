import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import type { Module } from "@/types/module";
import ModuleFormDialog from "./module-form-dialog";
import { makeModule } from "./test-fixtures";

const state = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/mutations/module/use-create-module", () => ({
  useCreateModule: () => ({ mutateAsync: state.create }),
}));

vi.mock("@/hooks/mutations/module/use-update-module", () => ({
  useUpdateModule: () => ({ mutateAsync: state.update }),
}));

vi.mock(
  "@/hooks/queries/workspace-users/use-get-active-workspace-users",
  () => ({ useGetActiveWorkspaceUsers: () => ({ data: { members: [] } }) }),
);

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: state.toastError },
}));

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  state.create.mockReset();
  state.update.mockReset();
  state.toastError.mockReset();
});

function renderDialog(module?: Module) {
  const onOpenChange = vi.fn();
  const onSaved = vi.fn();
  render(
    <ModuleFormDialog
      open
      onOpenChange={onOpenChange}
      projectId="project-1"
      workspaceId="ws-1"
      module={module}
      onSaved={onSaved}
    />,
  );
  return { onOpenChange, onSaved };
}

describe("ModuleFormDialog", () => {
  it("requires a name before creating", async () => {
    renderDialog();
    fireEvent.click(
      await screen.findByRole("button", { name: "modules:form.create" }),
    );
    expect(
      await screen.findByText("modules:form.nameRequired"),
    ).toBeInTheDocument();
    expect(state.create).not.toHaveBeenCalled();
  });

  it("creates with the trimmed name and reports the new module", async () => {
    const created = makeModule({ id: "new-module", name: "Billing" });
    state.create.mockResolvedValue(created);
    const { onOpenChange, onSaved } = renderDialog();
    fireEvent.change(await screen.findByLabelText("modules:form.name"), {
      target: { value: "  Billing " },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "modules:form.create" }),
    );

    await waitFor(() =>
      expect(state.create).toHaveBeenCalledWith({
        projectId: "project-1",
        name: "Billing",
        status: "backlog",
      }),
    );
    expect(onSaved).toHaveBeenCalledWith(created, true);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows a taken name on the name field instead of a toast", async () => {
    state.create.mockRejectedValue(
      new HttpError(409, "A module with this name already exists"),
    );
    renderDialog();
    fireEvent.change(await screen.findByLabelText("modules:form.name"), {
      target: { value: "Billing" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "modules:form.create" }),
    );

    expect(
      await screen.findByText("modules:form.nameTaken"),
    ).toBeInTheDocument();
    expect(state.toastError).not.toHaveBeenCalled();
  });

  it("sends only the changed fields when editing", async () => {
    const module = makeModule();
    state.update.mockResolvedValue({ ...module, name: "Billing v3" });
    renderDialog(module);
    fireEvent.change(await screen.findByLabelText("modules:form.name"), {
      target: { value: "Billing v3" },
    });
    fireEvent.click(screen.getByRole("button", { name: "modules:form.save" }));

    await waitFor(() =>
      expect(state.update).toHaveBeenCalledWith({
        moduleId: module.id,
        projectId: "project-1",
        json: { name: "Billing v3" },
      }),
    );
  });

  it("asks before discarding a dirty form", async () => {
    const { onOpenChange } = renderDialog();
    fireEvent.change(await screen.findByLabelText("modules:form.name"), {
      target: { value: "Half-typed" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "modules:form.cancel" }),
    );

    expect(
      await screen.findByText("modules:form.discardTitle"),
    ).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "modules:form.discard" }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes a clean form without asking", async () => {
    const { onOpenChange } = renderDialog();
    fireEvent.click(
      await screen.findByRole("button", { name: "modules:form.cancel" }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByText("modules:form.discardTitle")).toBeNull();
  });
});
