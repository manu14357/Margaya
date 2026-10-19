import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HomePage from "./home-page";

const mocks = vi.hoisted(() => ({
  preferences: {} as {
    data?: { widgets: { key: string; enabled: boolean }[] };
    isLoading: boolean;
    isError?: boolean;
  },
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/common/header/top-bar", () => ({
  TopBar: ({ actions }: { actions?: ReactNode }) => <header>{actions}</header>,
}));
vi.mock("./home-focus", () => ({ default: () => null }));
vi.mock("@/hooks/queries/home/use-get-home-preferences", () => ({
  default: () => mocks.preferences,
}));
vi.mock("./home-greeting", () => ({ default: () => <h1>greeting</h1> }));
vi.mock("./get-started", () => ({ default: () => null }));
vi.mock("./manage-widgets-dialog", () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div role="dialog">manage dialog</div> : null,
}));
vi.mock("@/components/quick-link/quick-links-widget", () => ({
  default: () => <section>widget:quick-links</section>,
}));
vi.mock("./recents-widget", () => ({
  default: () => <section>widget:recents</section>,
}));
vi.mock("@/components/sticky/stickies-widget", () => ({
  default: () => <section>widget:stickies</section>,
}));
vi.mock("@/components/delivery/home-risks-widget", () => ({
  default: () => <section>widget:risks</section>,
}));
vi.mock("@/components/insight/my-brief-widget", () => ({
  default: () => <section>widget:my-brief</section>,
}));
vi.mock("@/components/task/task-details-sheet", () => ({
  default: ({ taskId }: { taskId?: string }) =>
    taskId ? <aside>sheet:{taskId}</aside> : null,
}));

function renderHome(props: { taskId?: string; projectId?: string } = {}) {
  return render(
    <HomePage
      workspaceId="ws-1"
      onOpenTask={vi.fn()}
      onCloseTask={vi.fn()}
      {...props}
    />,
  );
}

const widgetOrder = () =>
  screen.queryAllByText(/^widget:/).map((node) => node.textContent);

beforeEach(() => {
  mocks.preferences = { isLoading: false };
});

afterEach(() => {
  cleanup();
});

describe("HomePage", () => {
  it("renders the widgets in the saved order, skipping disabled ones", () => {
    mocks.preferences = {
      isLoading: false,
      data: {
        widgets: [
          { key: "stickies", enabled: true },
          { key: "quick-links", enabled: false },
          { key: "recents", enabled: true },
        ],
      },
    };
    renderHome();
    // Keys missing from a stored list are appended, on.
    expect(widgetOrder()).toEqual([
      "widget:stickies",
      "widget:recents",
      "widget:risks",
    ]);
  });

  it("shows the empty state with Manage widgets when every widget is off", () => {
    mocks.preferences = {
      isLoading: false,
      data: {
        widgets: [
          { key: "quick-links", enabled: false },
          { key: "recents", enabled: false },
          { key: "stickies", enabled: false },
          { key: "risks", enabled: false },
        ],
      },
    };
    renderHome();
    expect(widgetOrder()).toEqual([]);
    expect(screen.getByText("home:empty.title")).toBeInTheDocument();

    const buttons = screen.getAllByRole("button", {
      name: "home:manageWidgets",
    });
    fireEvent.click(buttons[buttons.length - 1]);
    expect(screen.getByRole("dialog")).toHaveTextContent("manage dialog");
  });

  it("falls back to the default widgets when preferences fail to load", () => {
    mocks.preferences = { isLoading: false, isError: true };
    renderHome();
    expect(widgetOrder()).toEqual([
      "widget:quick-links",
      "widget:recents",
      "widget:stickies",
      "widget:risks",
    ]);
  });

  it("shows My brief only once the person turned it on", () => {
    mocks.preferences = {
      isLoading: false,
      data: { widgets: [{ key: "my-brief", enabled: true }] },
    };
    renderHome();
    expect(widgetOrder()[0]).toBe("widget:my-brief");
  });

  it("opens the task sheet only when both search params are set", () => {
    const { unmount } = renderHome({ taskId: "t-1" });
    expect(screen.queryByText("sheet:t-1")).toBeNull();
    unmount();

    renderHome({ taskId: "t-1", projectId: "p-1" });
    expect(screen.getByText("sheet:t-1")).toBeInTheDocument();
  });
});
