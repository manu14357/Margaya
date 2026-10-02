import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IntakeSearch } from "@/lib/intake-search";
import type { IntakeCounts, IntakeItem } from "@/types/intake";
import IntakeScreen from "./intake-screen";
import { intakeItem } from "./intake-test-fixtures";

const api = vi.hoisted(() => ({
  getItems: vi.fn(),
  mobile: { value: false },
  canRead: { value: true },
  commands: [] as string[],
}));

// Dialogs and menus render slowly on a busy machine.
vi.setConfig({ testTimeout: 20_000 });

vi.mock("@/fetchers/intake/get-intake-items", () => ({
  default: api.getItems,
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => api.mobile.value }));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canReadIntake: () => api.canRead.value,
    canTriageIntake: () => true,
    isCheckingPermissions: false,
  }),
}));
vi.mock(
  "@/hooks/queries/workspace-users/use-get-active-workspace-users",
  () => ({ useGetActiveWorkspaceUsers: () => ({ data: { members: [] } }) }),
);
// The detail pane has its own tests; this stub reports triage outcomes
// and records the commands the queue's keys send it.
vi.mock("./intake-detail", () => ({
  default: ({
    itemId,
    onChanged,
    commandRef,
  }: {
    itemId: string;
    onChanged: (item: IntakeItem) => void;
    commandRef?: { current: ((command: string) => boolean) | null };
  }) => {
    if (commandRef) {
      commandRef.current = (command) => {
        api.commands.push(`${itemId}:${command}`);
        return true;
      };
    }
    return (
      <div data-testid="detail">
        {itemId}
        <button
          type="button"
          onClick={() =>
            onChanged(intakeItem({ id: itemId, status: "accepted" }))
          }
        >
          accept-stub
        </button>
      </div>
    );
  },
}));
vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  api.mobile.value = false;
  api.canRead.value = true;
  api.commands.length = 0;
  window.localStorage.clear();
});

const NO_COUNTS: IntakeCounts = {
  pending: 0,
  snoozed: 0,
  accepted: 0,
  declined: 0,
  duplicate: 0,
};

function page(items: IntakeItem[], counts: Partial<IntakeCounts> = {}) {
  return {
    items,
    page: 1,
    limit: 50,
    total: items.length,
    hasMore: false,
    counts: { ...NO_COUNTS, ...counts },
  };
}

const ROWS = [
  intakeItem({ id: "a", task: { key: "web-1", title: "First" } }),
  intakeItem({ id: "b", task: { key: "web-2", title: "Second" } }),
  intakeItem({ id: "c", task: { key: "web-3", title: "Third" } }),
];

function Harness({ initial }: { initial: IntakeSearch }) {
  const [search, setSearch] = useState<IntakeSearch>(initial);
  return (
    <>
      <output data-testid="search">{JSON.stringify(search)}</output>
      <IntakeScreen
        projectId="p1"
        workspaceId="ws"
        search={search}
        onSearchChange={(patch) => setSearch((prev) => ({ ...prev, ...patch }))}
        onCreate={vi.fn()}
      />
    </>
  );
}

function renderScreen(initial: IntakeSearch = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Harness initial={initial} />
    </QueryClientProvider>,
  );
}

const searchState = () =>
  JSON.parse(screen.getByTestId("search").textContent ?? "{}") as IntakeSearch;

describe("IntakeScreen", () => {
  it("invites the first request in an empty project", async () => {
    api.getItems.mockResolvedValue(page([]));
    renderScreen();
    expect(
      await screen.findByText("intake:empty.noRequests.title"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "intake:newRequest" }),
    ).toBeInTheDocument();
  });

  it("says caught up when only closed requests exist", async () => {
    api.getItems.mockResolvedValue(page([], { declined: 2 }));
    renderScreen();
    expect(
      await screen.findByText("intake:empty.caughtUp.title"),
    ).toBeInTheDocument();
  });

  it("has its own empty states for the closed tab, filters and requesters", async () => {
    api.getItems.mockResolvedValue(page([], { pending: 1 }));
    renderScreen({ tab: "closed" });
    expect(
      await screen.findByText("intake:empty.noClosed.title"),
    ).toBeInTheDocument();
    cleanup();

    renderScreen({ priority: ["urgent"] });
    expect(
      await screen.findByText("intake:empty.noMatches.title"),
    ).toBeInTheDocument();
    cleanup();

    api.canRead.value = false;
    api.getItems.mockResolvedValue(page([]));
    renderScreen();
    expect(
      await screen.findByText("intake:empty.mine.title"),
    ).toBeInTheDocument();
  });

  it("writes the selected request to the URL", async () => {
    api.getItems.mockResolvedValue(page(ROWS, { pending: 3 }));
    renderScreen();
    fireEvent.click(await screen.findByText("Second"));
    expect(searchState().item).toBe("b");
    expect(screen.getByTestId("detail")).toHaveTextContent("b");
  });

  it("selects the next request after one leaves the list", async () => {
    api.getItems.mockResolvedValue(page(ROWS, { pending: 3 }));
    renderScreen({ item: "b" });
    await screen.findByText("Second");
    fireEvent.click(screen.getByRole("button", { name: "accept-stub" }));
    await waitFor(() => expect(searchState().item).toBe("c"));
  });

  it("moves the selection with the arrow keys", async () => {
    api.getItems.mockResolvedValue(page(ROWS, { pending: 3 }));
    renderScreen({ item: "a" });
    const first = await screen.findByText("First");
    fireEvent.keyDown(first, { key: "ArrowDown" });
    await waitFor(() => expect(searchState().item).toBe("b"));
  });

  it("moves with J and K anywhere on the page", async () => {
    api.getItems.mockResolvedValue(page(ROWS, { pending: 3 }));
    renderScreen({ item: "a" });
    await screen.findByText("First");
    fireEvent.keyDown(document.body, { key: "j" });
    await waitFor(() => expect(searchState().item).toBe("b"));
    fireEvent.keyDown(document.body, { key: "k" });
    await waitFor(() => expect(searchState().item).toBe("a"));
  });

  it("moves from the row just clicked", async () => {
    api.getItems.mockResolvedValue(page(ROWS, { pending: 3 }));
    renderScreen();
    fireEvent.click(await screen.findByText("First"));
    fireEvent.keyDown(document.body, { key: "j" });
    await waitFor(() => expect(searchState().item).toBe("b"));
  });

  it("ignores the keys until the list has loaded", async () => {
    let resolve: (value: unknown) => void = () => {};
    api.getItems.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    renderScreen();
    fireEvent.keyDown(document.body, { key: "j" });
    fireEvent.keyDown(document.body, { key: "a" });
    expect(searchState().item).toBeUndefined();
    expect(api.commands).toEqual([]);
    resolve(page(ROWS, { pending: 3 }));
    await screen.findByText("First");
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute(
        "data-intake-item-id",
        "a",
      ),
    );
  });

  it("sends A, D, S, U and Enter to the open request", async () => {
    api.getItems.mockResolvedValue(page(ROWS, { pending: 3 }));
    renderScreen({ item: "b" });
    await screen.findByTestId("detail");
    for (const key of ["a", "d", "s", "u", "Enter"]) {
      fireEvent.keyDown(document.body, { key });
    }
    expect(api.commands).toEqual([
      "b:accept",
      "b:decline",
      "b:snooze",
      "b:duplicate",
      "b:open",
    ]);
  });

  // The router applies the URL's `item` a moment late: a key pressed right
  // after J used to act on the previous request (its decline dialog opened,
  // then vanished when the URL caught up).
  it("acts on the request J moved to before the URL catches up", async () => {
    api.getItems.mockResolvedValue(page(ROWS, { pending: 3 }));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const queued: Partial<IntakeSearch>[] = [];
    let flush = () => {};
    function LaggingRouter() {
      const [search, setSearch] = useState<IntakeSearch>({ item: "a" });
      flush = () =>
        setSearch((prev) => Object.assign({ ...prev }, ...queued.splice(0)));
      return (
        <IntakeScreen
          projectId="p1"
          workspaceId="ws"
          search={search}
          onSearchChange={(patch) => queued.push(patch)}
          onCreate={vi.fn()}
        />
      );
    }
    render(
      <QueryClientProvider client={client}>
        <LaggingRouter />
      </QueryClientProvider>,
    );
    await screen.findByText("First");
    expect(screen.getByTestId("detail")).toHaveTextContent("a");

    fireEvent.keyDown(document.body, { key: "j" });
    expect(screen.getByTestId("detail")).toHaveTextContent("b");
    fireEvent.keyDown(document.body, { key: "d" });
    expect(api.commands).toEqual(["b:decline"]);

    // The URL catches up; a later navigation elsewhere wins again.
    act(() => flush());
    expect(screen.getByTestId("detail")).toHaveTextContent("b");
    queued.push({ item: "c" });
    act(() => flush());
    expect(screen.getByTestId("detail")).toHaveTextContent("c");
  });

  it("leaves the keys alone while typing or after a sequence prefix", async () => {
    api.getItems.mockResolvedValue(page(ROWS, { pending: 3 }));
    renderScreen({ item: "a" });
    await screen.findByTestId("detail");
    const field = document.createElement("input");
    document.body.append(field);
    fireEvent.keyDown(field, { key: "a" });
    field.remove();
    fireEvent.keyDown(document.body, { key: "g" });
    fireEvent.keyDown(document.body, { key: "a" });
    expect(api.commands).toEqual([]);
  });

  it("opens the detail in a sheet on narrow screens", async () => {
    api.mobile.value = true;
    api.getItems.mockResolvedValue(page(ROWS, { pending: 3 }));
    renderScreen({ item: "a" });
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("a");
  });
});
