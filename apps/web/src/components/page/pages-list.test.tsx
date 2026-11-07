import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PageSummary } from "@/types/page";
import { pageMenuItemIds } from "./page-row-actions";
import PagesList from "./pages-list";

const state = vi.hoisted(() => ({
  pages: [] as unknown[],
  isLoading: false,
  isError: false,
  favorites: [] as { entityType: string; entityId: string }[],
}));

vi.mock("@/lib/i18n", () => ({
  i18n: { t: (key: string) => key, language: "en-US" },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.title ? `${key}:${options.title}` : key,
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: { children?: ReactNode }) => (
    <a href="/page" {...(props as Record<string, unknown>)}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
}));

vi.mock("@/hooks/queries/page/use-get-pages", () => ({
  useGetPages: () => ({
    data: state.pages,
    isLoading: state.isLoading,
    isError: state.isError,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/queries/favorite/use-get-favorites", () => ({
  default: () => ({ data: state.favorites }),
}));

vi.mock("./use-page-members", () => ({
  usePageMembers: () => ({
    getMember: (id: string | null) =>
      id ? { id, name: `Member ${id}`, image: null } : null,
  }),
}));

vi.mock("./use-page-actions", () => ({
  usePageActions: () => ({
    openInNewTab: vi.fn(),
    copyLink: vi.fn(),
    duplicate: vi.fn(),
    toggleLock: vi.fn(),
    toggleAccess: vi.fn(),
    toggleArchive: vi.fn(),
    newSubpage: vi.fn(),
    openMove: vi.fn(),
    openDelete: vi.fn(),
    isCreatingSubpage: false,
    dialogs: null,
  }),
}));

vi.mock("@/components/favorite/favorite-button", () => ({
  default: () => <span>favorite</span>,
}));

const ALL = {
  canEdit: true,
  canLock: true,
  canChangeAccess: true,
  canArchive: true,
  canDelete: true,
  canDuplicate: true,
  canMove: true,
  canCreateSubpage: true,
  canRestoreVersion: true,
  canComment: true,
};

function makePage(overrides: Partial<PageSummary> = {}): PageSummary {
  return {
    id: "page",
    workspaceId: "w1",
    projectId: "p1",
    parentId: null,
    position: 0,
    title: "Spec",
    logoKind: null,
    logoValue: null,
    access: "public",
    ownerId: "u1",
    isLocked: false,
    lockedById: null,
    lockedAt: null,
    archivedAt: null,
    isFullWidth: false,
    createdById: "u1",
    updatedById: "u1",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    capabilities: ALL,
    ...overrides,
  } as PageSummary;
}

function renderList(tab: "public" | "private" | "archived" = "public") {
  const onCreate = vi.fn();
  render(
    <PagesList
      workspaceId="w1"
      projectId="p1"
      tab={tab}
      onTabChange={vi.fn()}
      onCreate={onCreate}
    />,
  );
  return { onCreate };
}

afterEach(() => {
  cleanup();
  state.pages = [];
  state.isLoading = false;
  state.isError = false;
  state.favorites = [];
  window.localStorage.clear();
});

/** Opens the collapsed search and returns its field. */
async function openSearch() {
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "pages:list.searchPlaceholder" }),
    );
  });
  return screen.getByRole("textbox", { name: "pages:list.searchPlaceholder" });
}

async function openFilters() {
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: /pages:filters.button/ }),
    );
  });
}

describe("PagesList", () => {
  it("counts pages per tab and lists the active tab's pages", () => {
    state.pages = [
      makePage({ id: "a", title: "Alpha" }),
      makePage({ id: "b", title: "Beta", parentId: "a" }),
      makePage({ id: "c", title: "Mine", access: "private" }),
      makePage({ id: "d", title: "Old", archivedAt: "2026-10-02T00:00:00Z" }),
    ];
    renderList();
    const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent);
    expect(tabs).toEqual([
      "pages:list.tabs.public2",
      "pages:list.tabs.private1",
      "pages:list.tabs.archived1",
    ]);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    // A sub-page names its parent path.
    expect(screen.getByText("pages:list.inParent")).toBeInTheDocument();
  });

  it("shows the first-page empty state with New page", () => {
    const { onCreate } = renderList();
    expect(screen.getByText("pages:list.empty.none.title")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /pages:list.newPage/ }));
    expect(onCreate).toHaveBeenCalled();
  });

  it.each([
    ["private", "pages:list.empty.private.title"],
    ["archived", "pages:list.empty.archived.title"],
    ["public", "pages:list.empty.public.title"],
  ] as const)("shows the %s tab's empty state", (tab, title) => {
    state.pages = [
      makePage({
        id: "only",
        access: tab === "public" ? "private" : "public",
      }),
    ];
    renderList(tab);
    expect(screen.getByText(title)).toBeInTheDocument();
    const newPage = screen.queryByRole("button", {
      name: /pages:list.newPage/,
    });
    if (tab === "archived") expect(newPage).toBeNull();
    else expect(newPage).not.toBeNull();
  });

  it("shows No matching pages for a search without results", async () => {
    state.pages = [makePage({ id: "a", title: "Alpha" })];
    renderList();
    fireEvent.change(await openSearch(), { target: { value: "zzz" } });
    expect(
      screen.getByText("pages:list.empty.noMatch.title"),
    ).toBeInTheDocument();
  });

  it("opens the search from its icon and collapses it with Escape", async () => {
    state.pages = [
      makePage({ id: "a", title: "Alpha" }),
      makePage({ id: "b", title: "Beta" }),
    ];
    renderList();
    expect(
      screen.queryByRole("textbox", { name: "pages:list.searchPlaceholder" }),
    ).toBeNull();
    const field = await openSearch();
    fireEvent.change(field, { target: { value: "alp" } });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    // The first Escape clears the text, the second closes the field.
    fireEvent.keyDown(field, { key: "Escape" });
    expect(field).toHaveValue("");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    fireEvent.keyDown(field, { key: "Escape" });
    expect(
      screen.queryByRole("textbox", { name: "pages:list.searchPlaceholder" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "pages:list.searchPlaceholder" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("renders no column header above the rows", () => {
    state.pages = [makePage({ id: "a", title: "Alpha" })];
    renderList();
    // The old sticky header named the columns ("Name").
    expect(screen.queryByText("pages:list.sort.name")).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("filters by favorites, creator and created date, with removable chips", async () => {
    const now = Date.now();
    const daysAgo = (days: number) =>
      new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
    state.pages = [
      makePage({
        id: "a",
        title: "Alpha",
        ownerId: "u1",
        createdAt: daysAgo(0),
      }),
      makePage({
        id: "b",
        title: "Beta",
        ownerId: "u2",
        createdAt: daysAgo(3),
      }),
      makePage({
        id: "c",
        title: "Gamma",
        ownerId: "u2",
        createdAt: daysAgo(90),
      }),
    ];
    state.favorites = [
      { entityType: "page", entityId: "b" },
      { entityType: "page", entityId: "c" },
      { entityType: "task", entityId: "a" },
    ];
    renderList();
    const titles = () =>
      screen.getAllByRole("listitem").map((item) => item.textContent ?? "");

    await openFilters();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("checkbox", { name: "pages:filters.favorites" }),
      );
    });
    expect(titles().join(" ")).not.toContain("Alpha");
    expect(titles()).toHaveLength(2);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("radio", { name: "pages:filters.date.last7" }),
      );
    });
    expect(titles()).toHaveLength(1);
    expect(titles()[0]).toContain("Beta");

    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: /Member u1/ }));
    });
    expect(
      screen.getByText("pages:list.empty.noMatch.title"),
    ).toBeInTheDocument();

    // Three chips; each removes its own filter.
    const removeButtons = () =>
      screen.queryAllByRole("button", { name: "pages:filters.remove" });
    expect(removeButtons()).toHaveLength(3);
    await act(async () => {
      fireEvent.click(removeButtons()[0] as HTMLElement);
    });
    expect(removeButtons()).toHaveLength(2);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "common:actions.clearAll" }),
      );
    });
    expect(removeButtons()).toHaveLength(0);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("renders the row menu gated by capabilities", async () => {
    state.pages = [
      makePage({
        id: "a",
        title: "Alpha",
        capabilities: { ...ALL, canLock: false, canMove: false },
      }),
    ];
    renderList();
    fireEvent.click(
      screen.getByRole("button", { name: "pages:actions.more:Alpha" }),
    );
    await screen.findByRole("menuitem", { name: /pages:actions.copyLink/ });
    const items = screen
      .getAllByRole("menuitem")
      .map((item) => item.textContent);
    expect(items).toEqual([
      "pages:actions.openInNewTab",
      "pages:actions.copyLink",
      "pages:actions.duplicate",
      "pages:actions.makePrivate",
      "pages:actions.archive",
    ]);
  });
});

describe("pageMenuItemIds", () => {
  it("offers Delete only on archived pages", () => {
    const active = makePage();
    const archived = makePage({ archivedAt: "2026-10-02T00:00:00Z" });
    expect(pageMenuItemIds(active)).not.toContain("delete");
    expect(pageMenuItemIds(archived)).toContain("delete");
  });

  it("shows only safe items to a viewer", () => {
    const viewer = makePage({
      capabilities: Object.fromEntries(
        Object.keys(ALL).map((key) => [key, false]),
      ) as PageSummary["capabilities"],
    });
    expect(pageMenuItemIds(viewer, { withNewSubpage: true })).toEqual([
      "openInNewTab",
      "copyLink",
    ]);
  });
});
