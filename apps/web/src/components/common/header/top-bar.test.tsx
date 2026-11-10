import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TopBarLabel, TopBarRoomy } from "./top-bar-label";
import { TopBarCollapsible, useTopBarOverflowHost } from "./top-bar-overflow";

vi.setConfig({ testTimeout: 15_000 });

const mocks = vi.hoisted(() => ({
  openCommandPalette: vi.fn(),
  openAsk: vi.fn(),
  manageWidgets: vi.fn(),
  titleBar: null as null | { platform: string },
  belowRail: false,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/command-palette/palette-store", () => ({
  openCommandPalette: mocks.openCommandPalette,
}));
vi.mock("@/components/ai/ask/ask-button", () => ({
  AskButton: () => <button type="button">ask</button>,
  useAskAction: () => ({ label: "ask in menu", onSelect: mocks.openAsk }),
}));
vi.mock("@/components/notification/notification-dropdown", () => ({
  default: () => <button type="button">notifications</button>,
}));
vi.mock("@/components/common/shell-context", () => ({
  useShell: () => null,
}));
vi.mock("@/components/common/shell-menus", () => ({
  ShellUserAvatar: () => <span>avatar</span>,
  UserMenu: ({ trigger }: { trigger: ReactNode }) => trigger,
}));
vi.mock("@/components/desktop/desktop-title-bar", () => ({
  useDesktopTitleBar: () => mocks.titleBar,
  useDesktopDragRegion: () => ({}),
}));
vi.mock("@/components/ui/sidebar", () => ({
  SidebarTrigger: (props: { className?: string }) => (
    <button type="button" {...props}>
      panel
    </button>
  ),
  useIsBelowWidth: () => mocks.belowRail,
}));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({
    render,
    children,
  }: {
    render?: ReactElement;
    children?: ReactNode;
  }) =>
    render && isValidElement(render)
      ? cloneElement(render, undefined, children)
      : children,
  TooltipContent: () => null,
}));

const { TopBar } = await import("./top-bar");

/** Gives the bar (and its clusters) a layout jsdom does not have. */
function layout({
  bar,
  barScroll = () => bar,
}: {
  bar: number;
  barScroll?: (bar: HTMLElement) => number;
}) {
  const width = (element: HTMLElement, scroll: boolean) => {
    if (element.dataset.slot === "top-bar") {
      return scroll ? barScroll(element) : bar;
    }
    return 100;
  };
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
    function (this: HTMLElement) {
      return width(this, false);
    },
  );
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(
    function (this: HTMLElement) {
      return width(this, true);
    },
  );
}

beforeEach(() => {
  mocks.titleBar = null;
  mocks.belowRail = false;
  window.innerWidth = 1280;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  mocks.openCommandPalette.mockReset();
  mocks.openAsk.mockReset();
  mocks.manageWidgets.mockReset();
});

function Actions() {
  return (
    <>
      <TopBarRoomy>
        <span>stepper</span>
      </TopBarRoomy>
      <TopBarRoomy hideWhen="tight">
        <span>tile</span>
      </TopBarRoomy>
      <button type="button">
        <TopBarLabel>Create project</TopBarLabel>
      </button>
      <TopBarCollapsible
        item={{
          id: "widgets",
          label: "Manage widgets",
          icon: null,
          onSelect: mocks.manageWidgets,
        }}
      >
        <button type="button">widgets inline</button>
      </TopBarCollapsible>
    </>
  );
}

describe("TopBar density", () => {
  it("shows the command field, Ask, notifications and labels while roomy", () => {
    layout({ bar: 900 });
    render(<TopBar title="Home" actions={<Actions />} />);

    expect(
      document
        .querySelector("[data-slot='top-bar']")
        ?.getAttribute("data-density"),
    ).toBe("full");
    expect(
      document.querySelector("[data-slot='command-field']"),
    ).not.toBeNull();
    expect(document.querySelector("[data-slot='command-field-icon']")).toBe(
      null,
    );
    expect(screen.getByText("ask")).toBeInTheDocument();
    expect(screen.getByText("notifications")).toBeInTheDocument();
    expect(screen.getByText("stepper")).toBeInTheDocument();
    expect(screen.getByText("widgets inline")).toBeInTheDocument();
    expect(document.querySelector("[data-slot='top-bar-more']")).toBe(null);
    expect(screen.getByText("Create project")).not.toHaveClass("sr-only");
  });

  it("collapses search to an icon that opens the palette when narrow", () => {
    layout({ bar: 420 });
    render(<TopBar title="Home" actions={<Actions />} />);

    expect(document.querySelector("[data-slot='command-field']")).toBe(null);
    const search = screen.getByRole("button", {
      name: "navigation:shell.commandField",
    });
    expect(search).toHaveAttribute("data-slot", "command-field-icon");
    fireEvent.click(search);
    expect(mocks.openCommandPalette).toHaveBeenCalledTimes(1);

    expect(screen.queryByText("notifications")).toBe(null);
    expect(screen.queryByText("ask")).toBe(null);
    expect(screen.queryByText("widgets inline")).toBe(null);
    expect(screen.queryByText("stepper")).toBe(null);
    expect(screen.getByText("tile")).toBeInTheDocument();
    // The label stays for screen readers; the button shows its icon.
    expect(screen.getByText("Create project")).toHaveClass("sr-only");
  });

  it("goes compact when a wide bar still overflows", () => {
    // Only the full layout (with the command field) is too wide.
    layout({
      bar: 900,
      barScroll: (element) =>
        element.querySelector("[data-slot='command-field']") ? 1040 : 900,
    });
    render(<TopBar title="Home" actions={<Actions />} />);

    expect(
      document
        .querySelector("[data-slot='top-bar']")
        ?.getAttribute("data-density"),
    ).toBe("compact");
    expect(
      document.querySelector("[data-slot='command-field-icon']"),
    ).not.toBeNull();
  });

  it("moves Ask and secondary actions into More when crowded", async () => {
    layout({ bar: 420 });
    render(<TopBar title="Home" actions={<Actions />} />);

    fireEvent.click(
      screen.getByRole("button", { name: "navigation:sidebar.more" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Manage widgets" }),
    );
    expect(mocks.manageWidgets).toHaveBeenCalledTimes(1);

    fireEvent.click(
      screen.getByRole("button", { name: "navigation:sidebar.more" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "ask in menu" }),
    );
    expect(mocks.openAsk).toHaveBeenCalledTimes(1);
  });

  it("lets a page menu host the overflow instead of a second More", () => {
    function PageMenu() {
      const entries = useTopBarOverflowHost();
      return (
        <ul aria-label="page menu">
          {(entries ?? []).map((entry) => (
            <li key={entry.id}>{entry.label}</li>
          ))}
        </ul>
      );
    }
    layout({ bar: 420 });
    render(
      <TopBar
        title="Page"
        actions={
          <>
            <Actions />
            <PageMenu />
          </>
        }
      />,
    );

    expect(document.querySelector("[data-slot='top-bar-more']")).toBe(null);
    const menu = screen.getByRole("list", { name: "page menu" });
    expect(menu).toHaveTextContent("ask in menu");
    expect(menu).toHaveTextContent("Manage widgets");
  });

  it("keeps only the essentials when tight", () => {
    layout({ bar: 240 });
    render(<TopBar title="Home" actions={<Actions />} />);

    expect(screen.queryByText("ask")).toBe(null);
    expect(screen.queryByText("tile")).toBe(null);
    expect(
      document.querySelector("[data-slot='command-field-icon']"),
    ).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Home" })).toBeInTheDocument();
  });

  it("puts the account in the desktop title bar only beside the rail", () => {
    layout({ bar: 900 });
    mocks.titleBar = { platform: "windows" };
    const { unmount } = render(<TopBar title="Home" />);
    expect(
      document.querySelector("[data-slot='top-bar-account']"),
    ).not.toBeNull();
    unmount();

    // Without the rail the drawer's footer holds the account menu.
    mocks.belowRail = true;
    render(<TopBar title="Home" />);
    expect(document.querySelector("[data-slot='top-bar-account']")).toBe(null);
  });

  it("labels stay visible outside a top bar", () => {
    render(
      <button type="button">
        <TopBarLabel className="hidden md:inline">Summarize</TopBarLabel>
      </button>,
    );
    expect(screen.getByText("Summarize")).toHaveClass("hidden", "md:inline");
  });
});
