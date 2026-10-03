import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PageSummary } from "@/types/page";
import { pageMenuItemIds } from "./page-row-actions";
import PagesList from "./pages-list";

const state = vi.hoisted(() => ({
  pages: [] as unknown[],
  isLoading: false,
  isError: false,
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
  window.localStorage.clear();
});

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

  it("shows No matching pages for a search without results", () => {
    state.pages = [makePage({ id: "a", title: "Alpha" })];
    renderList();
    fireEvent.change(
      screen.getByRole("textbox", { name: "pages:list.searchPlaceholder" }),
      { target: { value: "zzz" } },
    );
    expect(
      screen.getByText("pages:list.empty.noMatch.title"),
    ).toBeInTheDocument();
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
