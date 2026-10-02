import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { homePreferencesQueryKey } from "@/hooks/queries/home/use-get-home-preferences";
import { DEFAULT_HOME_WIDGETS } from "./home-widgets";
import ManageWidgetsDialog from "./manage-widgets-dialog";

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, options?: { widget?: string }) =>
      options?.widget ? `${key}:${options.widget}` : key,
  }),
}));
vi.mock("@/fetchers/home/update-home-preferences", () => ({
  default: mocks.update,
}));
vi.mock("@/lib/toast", () => ({ toast: { error: mocks.toastError } }));

let queryClient: QueryClient;

const saved = {
  workspaceId: "ws-1",
  updatedAt: null,
  widgets: [...DEFAULT_HOME_WIDGETS],
};

function renderDialog() {
  return render(
    <QueryClientProvider client={queryClient}>
      <ManageWidgetsDialog
        workspaceId="ws-1"
        widgets={[...DEFAULT_HOME_WIDGETS]}
        isLoading={false}
        open
        onOpenChange={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(homePreferencesQueryKey("ws-1"), saved);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ManageWidgetsDialog", () => {
  it("sends the full list with the toggled widget disabled", async () => {
    mocks.update.mockResolvedValue(saved);
    renderDialog();

    fireEvent.click(
      screen.getByRole("switch", {
        name: "home:manage.toggle:home:widgets.recents",
      }),
    );

    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith({
        workspaceId: "ws-1",
        widgets: [
          { key: "quick-links", enabled: true },
          { key: "recents", enabled: false },
          { key: "stickies", enabled: true },
        ],
      }),
    );
  });

  it("rolls the cache back and toasts when saving fails", async () => {
    mocks.update.mockRejectedValue(new Error("offline"));
    renderDialog();

    fireEvent.click(
      screen.getByRole("switch", {
        name: "home:manage.toggle:home:widgets.stickies",
      }),
    );

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith("home:manage.saveError"),
    );
    expect(queryClient.getQueryData(homePreferencesQueryKey("ws-1"))).toEqual(
      saved,
    );
  });

  it("names every drag handle", () => {
    renderDialog();
    expect(
      screen.getByRole("button", {
        name: "home:manage.reorder:home:widgets.quickLinks",
      }),
    ).toBeInTheDocument();
  });
});
