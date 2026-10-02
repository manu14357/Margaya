import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { intakeDetailActions } from "@/lib/intake-actions";
import IntakeDetailHeader from "./intake-detail-header";
import { intakeItem } from "./intake-test-fixtures";

// Dialogs and menus render slowly on a busy machine.
vi.setConfig({ testTimeout: 20_000 });

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderHeader(
  actions: ReturnType<typeof intakeDetailActions> | null,
  item = intakeItem(),
) {
  const onAction = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntakeDetailHeader
        item={item}
        actions={actions}
        onAction={onAction}
        onSnoozed={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return { onAction };
}

const triager = {
  canTriage: true,
  canUpdateTasks: true,
  canDeleteTasks: true,
  isSubmitter: false,
};

describe("IntakeDetailHeader", () => {
  it("shows the key and status", () => {
    renderHeader(null);
    expect(screen.getByText("WEB-42")).toBeInTheDocument();
    expect(screen.getByText("intake:status.pending.label")).toBeInTheDocument();
  });

  it("renders no actions while permissions load", () => {
    renderHeader(null);
    expect(screen.queryByText("intake:actions.accept")).toBeNull();
    expect(screen.queryByLabelText("intake:detail.moreActions")).toBeNull();
  });

  it("offers a triager's pending actions and menu", async () => {
    const { onAction } = renderHeader(
      intakeDetailActions({ ...triager, status: "pending" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "intake:actions.accept" }),
    );
    expect(onAction).toHaveBeenCalledWith("accept");
    fireEvent.click(
      screen.getByRole("button", { name: "intake:actions.decline" }),
    );
    expect(onAction).toHaveBeenCalledWith("decline");
    expect(
      screen.getByRole("button", { name: "intake:actions.snooze" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("intake:detail.moreActions"));
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "intake:actions.duplicate",
      "intake:detail.copyLink",
      "intake:detail.openTaskPage",
      "intake:actions.delete",
    ]);
    fireEvent.click(items[0] as HTMLElement);
    expect(onAction).toHaveBeenCalledWith("duplicate");
  });

  it("offers reopen on declined requests", () => {
    const { onAction } = renderHeader(
      intakeDetailActions({ ...triager, status: "declined" }),
      intakeItem({ status: "declined" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "intake:actions.reopen" }),
    );
    expect(onAction).toHaveBeenCalledWith("reopen");
    expect(screen.queryByText("intake:actions.accept")).toBeNull();
  });

  it("gives a requester edit and withdraw", async () => {
    const { onAction } = renderHeader(
      intakeDetailActions({
        canTriage: false,
        canUpdateTasks: false,
        canDeleteTasks: false,
        isSubmitter: true,
        status: "pending",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "intake:detail.editRequest" }),
    );
    expect(onAction).toHaveBeenCalledWith("edit");
    fireEvent.click(screen.getByLabelText("intake:detail.moreActions"));
    expect(
      await screen.findByRole("menuitem", { name: "intake:actions.withdraw" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("intake:actions.accept")).toBeNull();
  });
});
