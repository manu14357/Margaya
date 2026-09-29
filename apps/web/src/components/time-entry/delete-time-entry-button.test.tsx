import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DeleteTimeEntryButton from "./delete-time-entry-button";

const m = vi.hoisted(() => ({
  mutate: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}));
vi.mock("@/hooks/mutations/time-entry/use-delete-time-entry", () => ({
  default: (taskId: string) => ({
    mutate: (id: string, callbacks: unknown) => m.mutate(taskId, id, callbacks),
    isPending: false,
  }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: m.toastSuccess, error: m.toastError },
}));

type Callbacks = {
  onSuccess: () => void;
  onError: (error: Error) => void;
};

function renderButton() {
  render(<DeleteTimeEntryButton taskId="t1" entryId="e1" dateLabel="Sep 1" />);
  return screen.getByRole("button", {
    name: 'tasks:timeTracking.deleteEntry {"date":"Sep 1"}',
  });
}

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

describe("DeleteTimeEntryButton", () => {
  it("asks first, then deletes the entry of its task", () => {
    fireEvent.click(renderButton());
    expect(m.mutate).not.toHaveBeenCalled();
    expect(screen.getByText("tasks:timeTracking.deleteConfirm")).toBeVisible();

    const confirm = screen.getByRole("button", {
      name: "common:actions.delete",
    });
    expect(confirm).toHaveFocus();
    fireEvent.click(confirm);

    expect(m.mutate).toHaveBeenCalledWith("t1", "e1", expect.anything());
    (m.mutate.mock.calls[0][2] as Callbacks).onSuccess();
    expect(m.toastSuccess).toHaveBeenCalledWith("tasks:timeTracking.deleted");
  });

  it("goes back without deleting on cancel", () => {
    fireEvent.click(renderButton());
    fireEvent.click(
      screen.getByRole("button", { name: "common:actions.cancel" }),
    );

    expect(m.mutate).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /tasks:timeTracking.deleteEntry/ }),
    ).toBeInTheDocument();
  });

  it("shows the API's reason when the delete is refused", () => {
    fireEvent.click(renderButton());
    fireEvent.click(
      screen.getByRole("button", { name: "common:actions.delete" }),
    );
    (m.mutate.mock.calls[0][2] as Callbacks).onError(
      new Error("Only the person who logged this time can delete it"),
    );

    expect(m.toastError).toHaveBeenCalledWith(
      "Only the person who logged this time can delete it",
    );
  });
});
