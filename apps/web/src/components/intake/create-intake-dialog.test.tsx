import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CreateIntakeDialog from "./create-intake-dialog";
import { intakeItem } from "./intake-test-fixtures";

const api = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

// Dialogs and menus render slowly on a busy machine.
vi.setConfig({ testTimeout: 20_000 });

vi.mock("@/fetchers/intake/create-intake-item", () => ({
  default: api.create,
}));
vi.mock("@/fetchers/intake/update-intake-item", () => ({
  default: api.update,
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: api.toastSuccess, error: api.toastError },
}));
// The rich editor is out of scope here; the dialog passes no task id, so
// the real one offers no uploads.
vi.mock("@/components/task/task-description-editor", () => ({
  default: ({
    value,
    onChange,
    taskId,
  }: {
    value: string;
    onChange: (value: string) => void;
    taskId?: string;
  }) => (
    <textarea
      aria-label="description"
      data-task-id={taskId ?? "none"}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));
vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderDialog(
  props: Partial<Parameters<typeof CreateIntakeDialog>[0]> = {},
) {
  const onOpenChange = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <CreateIntakeDialog
        open
        onOpenChange={onOpenChange}
        projectId="p1"
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onOpenChange };
}

const titleInput = () =>
  screen.getByRole("textbox", { name: "intake:create.titlePlaceholder" });
const submitButton = () =>
  screen.getByRole("button", { name: "intake:create.submit" });

describe("CreateIntakeDialog", () => {
  it("needs a title and offers no uploads", () => {
    renderDialog();
    expect(submitButton()).toBeDisabled();
    fireEvent.change(titleInput(), { target: { value: "  " } });
    expect(submitButton()).toBeDisabled();
    expect(screen.getByLabelText("description")).toHaveAttribute(
      "data-task-id",
      "none",
    );
  });

  it("submits with Ctrl+Enter and closes", async () => {
    api.create.mockResolvedValue(intakeItem());
    const { onOpenChange } = renderDialog();
    fireEvent.change(titleInput(), { target: { value: "Export fails" } });
    fireEvent.keyDown(titleInput(), { key: "Enter", ctrlKey: true });
    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith("p1", {
        title: "Export fails",
        description: "",
        priority: "no-priority",
      }),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(api.toastSuccess).toHaveBeenCalled();
  });

  it("clears and stays open with Create more", async () => {
    api.create.mockResolvedValue(intakeItem());
    const { onOpenChange } = renderDialog();
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.change(titleInput(), { target: { value: "First" } });
    fireEvent.click(submitButton());
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(titleInput()).toHaveValue(""));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("prefills an edit and saves through the update route", async () => {
    api.update.mockResolvedValue(intakeItem());
    const { onOpenChange } = renderDialog({
      intakeItem: intakeItem(),
      description: "Steps",
    });
    expect(titleInput()).toHaveValue("Export fails on Safari");
    expect(screen.getByLabelText("description")).toHaveValue("Steps");
    expect(screen.queryByRole("switch")).toBeNull();
    fireEvent.change(titleInput(), { target: { value: "Export fails" } });
    fireEvent.click(screen.getByRole("button", { name: "intake:create.save" }));
    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith("item-1", {
        title: "Export fails",
        description: "Steps",
        priority: "high",
      }),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("asks before discarding what was typed", async () => {
    const { onOpenChange } = renderDialog();
    fireEvent.change(titleInput(), { target: { value: "Draft" } });
    fireEvent.click(
      screen.getByRole("button", { name: "common:actions.cancel" }),
    );
    expect(
      await screen.findByText("intake:create.discardTitle"),
    ).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "intake:create.discard" }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes at once when nothing was typed", () => {
    const { onOpenChange } = renderDialog();
    fireEvent.click(
      screen.getByRole("button", { name: "common:actions.cancel" }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
