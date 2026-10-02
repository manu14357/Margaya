import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AcceptIntakeDialog from "./accept-intake-dialog";
import { intakeItem } from "./intake-test-fixtures";

const api = vi.hoisted(() => ({
  getColumns: vi.fn(),
  accept: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

// Dialogs and menus render slowly on a busy machine.
vi.setConfig({ testTimeout: 20_000 });

vi.mock("@/fetchers/column/get-columns", () => ({ default: api.getColumns }));
vi.mock("@/fetchers/intake/accept-intake-item", () => ({
  default: api.accept,
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/lib/toast", () => ({
  toast: { success: api.toastSuccess, error: api.toastError },
}));
vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function column(
  slug: string,
  name: string,
  group: string,
  position: number,
): Record<string, unknown> {
  return {
    id: `col-${slug}`,
    slug,
    name,
    group,
    position,
    isFinal: group === "completed",
    icon: null,
  };
}

// The board order puts a backlog-group column first.
const COLUMNS = [
  column("done", "Done", "completed", 3),
  column("icebox", "Icebox", "backlog", 0),
  column("in-progress", "In Progress", "started", 2),
  column("to-do", "To Do", "unstarted", 1),
];

function renderDialog(onOpenChange = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <AcceptIntakeDialog
        open
        onOpenChange={onOpenChange}
        item={intakeItem()}
        workspaceId="ws"
      />
    </QueryClientProvider>,
  );
  return { onOpenChange };
}

const trigger = () =>
  screen.getByRole("combobox", { name: "intake:accept.columnLabel" });

describe("AcceptIntakeDialog", () => {
  it("defaults to the first not-started column", async () => {
    api.getColumns.mockResolvedValue(COLUMNS);
    renderDialog();
    await waitFor(() => expect(trigger()).toHaveTextContent("To Do"));
  });

  it("falls back to the backlog without an open column", async () => {
    api.getColumns.mockResolvedValue([column("done", "Done", "completed", 0)]);
    renderDialog();
    await waitFor(() => expect(trigger()).not.toBeDisabled());
    expect(trigger()).toHaveTextContent("intake:accept.backlog");
  });

  it("explains that a project without columns accepts to the backlog", async () => {
    api.getColumns.mockResolvedValue([]);
    renderDialog();
    expect(
      await screen.findByText("intake:accept.noColumns"),
    ).toBeInTheDocument();
  });

  it("lists the backlog first, then columns in board order", async () => {
    api.getColumns.mockResolvedValue(COLUMNS);
    renderDialog();
    await waitFor(() => expect(trigger()).toHaveTextContent("To Do"));
    fireEvent.click(trigger());
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "intake:accept.backlog",
      "Icebox",
      "To Do",
      "In Progress",
      "Done",
    ]);
  });

  it("accepts into the chosen column", async () => {
    api.getColumns.mockResolvedValue(COLUMNS);
    api.accept.mockResolvedValue(
      intakeItem({
        status: "accepted",
        task: { columnName: "In Progress", status: "in-progress" },
      }),
    );
    const { onOpenChange } = renderDialog();
    await waitFor(() => expect(trigger()).toHaveTextContent("To Do"));
    fireEvent.click(trigger());
    const option = await screen.findByRole("option", { name: "In Progress" });
    fireEvent.pointerDown(option, { pointerType: "mouse" });
    fireEvent.click(option);
    await waitFor(() => expect(trigger()).toHaveTextContent("In Progress"));

    fireEvent.click(
      screen.getByRole("button", { name: "intake:accept.submit" }),
    );
    await waitFor(() =>
      expect(api.accept).toHaveBeenCalledWith("item-1", "in-progress"),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(api.toastSuccess).toHaveBeenCalled();
  });

  it("stays open and shows the server message when refused", async () => {
    api.getColumns.mockResolvedValue(COLUMNS);
    api.accept.mockRejectedValue(
      new Error("This request was already accepted"),
    );
    const { onOpenChange } = renderDialog();
    await waitFor(() => expect(trigger()).toHaveTextContent("To Do"));
    fireEvent.click(
      screen.getByRole("button", { name: "intake:accept.submit" }),
    );
    await waitFor(() =>
      expect(api.toastError).toHaveBeenCalledWith(
        "This request was already accepted",
      ),
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
