import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CustomFieldBulkAction from "./custom-field-bulk-action";

const { state, mutateAsync, toastSuccess, toastError } = vi.hoisted(() => ({
  state: {
    fields: [] as unknown[],
    canUpdate: true,
  },
  mutateAsync: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock(
  "@/hooks/mutations/custom-field/use-bulk-set-custom-field-value",
  () => ({ default: () => ({ mutateAsync, isPending: false }) }),
);
vi.mock(
  "@/hooks/queries/custom-field/use-get-custom-fields-by-project",
  () => ({
    default: () => ({ data: state.fields }),
  }),
);
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canUpdateTasks: () => state.canUpdate,
    isCheckingPermissions: false,
  }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

const stage = {
  id: "f1",
  name: "Stage",
  type: "dropdown",
  required: false,
  options: ["Alpha", "Beta"],
};
const score = {
  id: "f2",
  name: "Score",
  type: "number",
  required: false,
  options: null,
};

function renderAction() {
  const onDone = vi.fn();
  render(
    <CustomFieldBulkAction
      taskIds={["t1", "t2"]}
      surface="board"
      onDone={onDone}
      projectId="p1"
      workspaceId="w1"
    />,
  );
  return onDone;
}

const open = () =>
  fireEvent.click(
    screen.getByRole("button", { name: "tasks:customFieldBulk.action" }),
  );

afterEach(cleanup);
beforeEach(() => {
  state.fields = [stage, score];
  state.canUpdate = true;
  mutateAsync.mockReset();
  mutateAsync.mockResolvedValue({ updatedCount: 2 });
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe("CustomFieldBulkAction", () => {
  it("hides without fields or permission", () => {
    state.fields = [];
    const { container, rerender } = render(
      <CustomFieldBulkAction
        taskIds={["t1"]}
        surface="board"
        onDone={vi.fn()}
        projectId="p1"
        workspaceId="w1"
      />,
    );
    expect(container.textContent).toBe("");

    state.fields = [stage];
    state.canUpdate = false;
    rerender(
      <CustomFieldBulkAction
        taskIds={["t1"]}
        surface="board"
        onDone={vi.fn()}
        projectId="p1"
        workspaceId="w1"
      />,
    );
    expect(container.textContent).toBe("");
  });

  it("sets a picked option on every selected task", async () => {
    const onDone = renderAction();
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Stage" }));
    fireEvent.click(await screen.findByRole("button", { name: "Beta" }));

    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mutateAsync).toHaveBeenCalledWith({
      taskIds: ["t1", "t2"],
      fieldId: "f1",
      value: "Beta",
    });
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("sets a typed value", async () => {
    const onDone = renderAction();
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Score" }));
    fireEvent.change(await screen.findByRole("spinbutton"), {
      target: { value: "5" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "tasks:customFieldBulk.apply" }),
    );

    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mutateAsync).toHaveBeenCalledWith({
      taskIds: ["t1", "t2"],
      fieldId: "f2",
      value: "5",
    });
  });

  it("keeps the selection and explains when it fails", async () => {
    mutateAsync.mockRejectedValue(new Error("Invalid option"));
    const onDone = renderAction();
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Stage" }));
    fireEvent.click(await screen.findByRole("button", { name: "Alpha" }));

    await vi.waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Invalid option"),
    );
    expect(onDone).not.toHaveBeenCalled();
  });
});
