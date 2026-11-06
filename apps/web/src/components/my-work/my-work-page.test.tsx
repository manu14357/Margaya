import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MyWorkPage from "./my-work-page";

const mocks = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));
vi.mock("@/components/common/layout", () => {
  const Layout = ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  );
  Layout.TopBar = () => null;
  Layout.ContentArea = ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  );
  return { default: Layout };
});
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/components/task-layouts/task-list-surface", () => ({
  default: ({ storageKey }: { storageKey: string }) => (
    <div>list:{storageKey}</div>
  ),
}));
vi.mock("@/hooks/use-task-query-state", () => ({
  useTaskQueryState: () => ({ setFilters: vi.fn() }),
}));
vi.mock("./my-work-summary", () => ({
  default: ({ onOpen }: { onOpen: (tab: string, preset?: string) => void }) => (
    <button type="button" onClick={() => onOpen("assigned", "overdue")}>
      summary tile
    </button>
  ),
}));
vi.mock("./my-work-tabs", () => ({
  MyWorkTabs: ({
    onSelectTab,
  }: {
    onSelectTab: (tab: "summary" | "assigned") => void;
  }) => (
    <>
      <button type="button" onClick={() => onSelectTab("summary")}>
        to summary
      </button>
      <button type="button" onClick={() => onSelectTab("assigned")}>
        to assigned
      </button>
    </>
  ),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MyWorkPage", () => {
  it("keeps the summary statistics one tab away", () => {
    render(<MyWorkPage workspaceId="ws" tab="assigned" />);
    expect(screen.getByText("list:my-work:assigned")).toBeInTheDocument();
    expect(screen.queryByText("summary tile")).toBeNull();

    fireEvent.click(screen.getByText("to summary"));
    expect(mocks.navigate).toHaveBeenCalledWith(
      expect.objectContaining({ search: { tab: "summary" } }),
    );
    cleanup();

    render(<MyWorkPage workspaceId="ws" tab="summary" />);
    expect(screen.getByText("summary tile")).toBeInTheDocument();
  });

  it("opens Assigned through the bare URL, keeping a tile's filter", () => {
    render(<MyWorkPage workspaceId="ws" tab="summary" />);
    fireEvent.click(screen.getByText("summary tile"));
    expect(mocks.navigate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        search: { tab: undefined, filter: "overdue" },
      }),
    );
    fireEvent.click(screen.getByText("to assigned"));
    expect(mocks.navigate).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: { tab: undefined } }),
    );
  });
});
