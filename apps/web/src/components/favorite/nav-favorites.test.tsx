import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { NavFavorites } from "./nav-favorites";

const mocks = vi.hoisted(() => ({
  favorites: vi.fn(),
  toggle: vi.fn(),
  reorder: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  useLocation: () => ({
    pathname: "/dashboard/workspace/ws-1/project/p-b/board",
  }),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "ws-1" } }),
}));
vi.mock("@/hooks/queries/favorite/use-get-favorites", () => ({
  default: () => mocks.favorites(),
}));
vi.mock("@/hooks/mutations/favorite/use-reorder-favorites", () => ({
  default: () => mocks.reorder,
}));
vi.mock("@/hooks/mutations/favorite/use-toggle-favorite", () => ({
  default: () => ({ mutate: mocks.toggle }),
  isOptimisticFavorite: (favorite: { id: string }) =>
    favorite.id.startsWith("optimistic:"),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const favorite = (id: string, name: string) => ({
  id,
  workspaceId: "ws-1",
  projectId: `p-${id}`,
  entityType: "project",
  entityId: `p-${id}`,
  position: 0,
  createdAt: "",
  entity: {
    type: "project",
    id: `p-${id}`,
    name,
    key: null,
    icon: null,
    projectId: `p-${id}`,
    projectName: name,
    isArchived: false,
    feature: null,
    details: null,
  },
});

function renderNav() {
  return render(
    <SidebarProvider>
      <NavFavorites />
    </SidebarProvider>,
  );
}

beforeEach(() => {
  mocks.favorites.mockReturnValue({
    data: [favorite("a", "Alpha"), favorite("b", "Beta")],
    isError: false,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("NavFavorites", () => {
  it("is hidden when there are no favorites", () => {
    mocks.favorites.mockReturnValue({ data: [], isError: false });
    renderNav();
    expect(screen.queryByText("navigation:sidebar.favorites")).toBeNull();
  });

  it("is hidden while loading or on error", () => {
    mocks.favorites.mockReturnValue({ data: undefined, isError: false });
    const { unmount } = renderNav();
    expect(screen.queryByText("navigation:sidebar.favorites")).toBeNull();
    unmount();
    mocks.favorites.mockReturnValue({ data: undefined, isError: true });
    renderNav();
    expect(screen.queryByText("navigation:sidebar.favorites")).toBeNull();
  });

  it("lists favorites in order and opens one on click", () => {
    renderNav();
    expect(
      screen.getByText("navigation:sidebar.favorites"),
    ).toBeInTheDocument();
    const names = screen
      .getAllByText(/Alpha|Beta/)
      .map((node) => node.textContent);
    expect(names).toEqual(["Alpha", "Beta"]);

    fireEvent.click(screen.getByText("Alpha"));
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/dashboard/workspace/ws-1/project/p-a/board",
    });
  });

  it("marks the favorite for the current route as active", () => {
    renderNav();
    const active = screen.getByText("Beta").closest("[data-active]");
    expect(active).toHaveAttribute("data-active", "true");
  });

  it("removes a favorite from its row menu", async () => {
    renderNav();
    fireEvent.click(screen.getAllByText("navigation:sidebar.more")[0]);
    fireEvent.click(await screen.findByText("navigation:favorites.remove"));
    await waitFor(() =>
      expect(mocks.toggle).toHaveBeenCalledWith(
        {
          workspaceId: "ws-1",
          entityType: "project",
          entityId: "p-a",
          isFavorite: true,
        },
        expect.any(Object),
      ),
    );
  });
});
