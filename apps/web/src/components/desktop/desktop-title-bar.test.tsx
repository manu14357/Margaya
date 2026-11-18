import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DesktopTitleBar,
  useDesktopDragRegion,
  useDesktopShellFrame,
  useDesktopTopRowDrag,
} from "./desktop-title-bar";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

type StateListener = (state: {
  maximized: boolean;
  focused: boolean;
  fullscreen: boolean;
}) => void;

function enterDesktopApp(
  platform: "windows" | "macos" | "linux",
  { style = "custom", maximized = false } = {},
) {
  // Every subscriber hears each change, as with the app's bridge.
  const listeners = new Set<StateListener>();
  const window_ = {
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
    startDragging: vi.fn(),
    isMaximized: vi.fn(async () => maximized),
    onStateChange: vi.fn((next: StateListener) => {
      listeners.add(next);
      return () => {
        listeners.delete(next);
      };
    }),
  };
  Object.defineProperty(window, "__MARGAYA_DESKTOP__", {
    configurable: true,
    value: {
      version: "0.2.0",
      platform,
      titleBar: {
        style,
        platform,
        leftInset: platform === "macos" ? 78 : 0,
        rightInset: 0,
      },
      window: window_,
    },
  });
  return {
    api: window_,
    emit: (state: Parameters<StateListener>[0]) =>
      act(() => {
        for (const listener of listeners) listener(state);
      }),
  };
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "__MARGAYA_DESKTOP__");
  document.documentElement.removeAttribute("style");
  for (const key of Object.keys(document.documentElement.dataset)) {
    delete document.documentElement.dataset[key];
  }
});

function Shell() {
  useDesktopShellFrame();
  return null;
}

function DragBar() {
  const drag = useDesktopDragRegion();
  return (
    <header data-testid="bar" {...drag}>
      <span data-testid="title">Inbox</span>
      <button type="button">Search</button>
      <a href="/x">Docs page</a>
      <input aria-label="field" />
    </header>
  );
}

/**
 * A press as a person makes it: a single press drags once the pointer moves,
 * a second click (detail 2) maximizes through the double-click.
 */
function pressInWindow(element: Element, init: MouseEventInit = {}) {
  const event = { button: 0, detail: 1, ...init };
  fireEvent.mouseDown(element, event);
  if ((event.detail ?? 1) >= 2) {
    fireEvent.doubleClick(element, event);
  } else {
    fireEvent.mouseMove(window, {
      buttons: 1,
      clientX: (event.clientX ?? 0) + 10,
      clientY: (event.clientY ?? 0) + 10,
    });
  }
  fireEvent.mouseUp(window);
}

const press = pressInWindow;

describe("desktop title bar", () => {
  it("renders nothing in a browser", () => {
    const { container } = render(
      <>
        <DesktopTitleBar />
        <DragBar />
      </>,
    );
    expect(container.querySelector("[data-slot='desktop-title-bar']")).toBe(
      null,
    );
    expect(screen.queryByRole("button", { name: /desktopWindow/ })).toBeNull();
    expect(screen.getByTestId("bar")).not.toHaveAttribute("data-window-drag");
    expect(document.documentElement.dataset.desktopSlimBar).toBeUndefined();
  });

  it("renders nothing with the native title bar", () => {
    enterDesktopApp("windows", { style: "native" });
    render(<DesktopTitleBar />);
    expect(screen.queryByRole("button", { name: /desktopWindow/ })).toBeNull();
  });

  it("gives pages without the shell a slim bar with the window buttons", () => {
    const { api } = enterDesktopApp("windows");
    const { container } = render(<DesktopTitleBar />);
    const bar = container.querySelector(
      "[data-slot='desktop-title-bar']",
    ) as HTMLElement;
    expect(bar).not.toBeNull();
    expect(bar.style.height).toBe("32px");
    expect(document.documentElement.dataset.desktopSlimBar).toBe("");
    expect(
      document.documentElement.style.getPropertyValue(
        "--desktop-slim-bar-height",
      ),
    ).toBe("32px");

    fireEvent.click(
      screen.getByRole("button", { name: "navigation:desktopWindow.minimize" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "navigation:desktopWindow.maximize" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "navigation:desktopWindow.close" }),
    );
    expect(api.minimize).toHaveBeenCalledOnce();
    expect(api.toggleMaximize).toHaveBeenCalledOnce();
    expect(api.close).toHaveBeenCalledOnce();

    // The bar itself moves the window; its buttons never do.
    press(bar);
    expect(api.startDragging).toHaveBeenCalledOnce();
    press(
      screen.getByRole("button", { name: "navigation:desktopWindow.close" }),
    );
    expect(api.startDragging).toHaveBeenCalledOnce();
  });

  it("puts only the buttons over the shell's top bar", () => {
    enterDesktopApp("windows");
    const { container } = render(
      <>
        <DesktopTitleBar />
        <Shell />
      </>,
    );
    expect(container.querySelector("[data-slot='desktop-title-bar']")).toBe(
      null,
    );
    const controls = container.querySelector(
      "[data-slot='window-controls']",
    ) as HTMLElement;
    expect(controls).toHaveClass("fixed", "top-0", "right-0");
    expect(
      screen.getByRole("button", { name: "navigation:desktopWindow.close" })
        .style.height,
    ).toBe("47px");
    expect(
      screen.getByRole("button", { name: "navigation:desktopWindow.close" })
        .style.width,
    ).toBe("46px");
    expect(document.documentElement.dataset.desktopSlimBar).toBeUndefined();
    expect(
      document.documentElement.style.getPropertyValue(
        "--desktop-controls-width",
      ),
    ).toBe("138px");
  });

  it("keeps overlay popups under the title bar line and the buttons above every backdrop", () => {
    enterDesktopApp("windows");
    const root = document.documentElement;
    const { container, rerender } = render(<DesktopTitleBar />);
    // Slim bar pages: overlays start under the 32px bar.
    expect(root.style.getPropertyValue("--desktop-frame-top")).toBe("32px");

    rerender(
      <>
        <DesktopTitleBar />
        <Shell />
      </>,
    );
    // With the shell, under its 48px top bar; the buttons stack above every
    // backdrop (the window-controls layer) so they stay clickable.
    expect(root.style.getPropertyValue("--desktop-frame-top")).toBe("48px");
    expect(
      container.querySelector("[data-slot='window-controls']"),
    ).toHaveClass("z-(--z-window-controls)");

    // A strip over the bar line (shown by desktop.css only while an overlay
    // dims the page) keeps moving the window, clear of the buttons.
    const strip = container.querySelector(
      "[data-slot='desktop-overlay-drag']",
    ) as HTMLElement;
    expect(strip).toHaveClass("fixed", "hidden", "z-(--z-window-controls)");
    expect(strip.style.height).toBe("48px");
    expect(strip.style.right).toBe("138px");
  });

  it("moves the window from the overlay strip", () => {
    const { api } = enterDesktopApp("macos");
    const { container } = render(
      <>
        <DesktopTitleBar />
        <Shell />
      </>,
    );
    const strip = container.querySelector(
      "[data-slot='desktop-overlay-drag']",
    ) as HTMLElement;
    expect(strip.style.right).toBe("0px");
    press(strip);
    expect(api.startDragging).toHaveBeenCalledOnce();
  });

  it("moves the window from a full-height panel's top row only", () => {
    const { api } = enterDesktopApp("linux");
    function Panel() {
      const drag = useDesktopTopRowDrag();
      return (
        <section data-testid="panel" {...drag}>
          <button type="button">Close</button>
        </section>
      );
    }
    render(<Panel />);
    const panel = screen.getByTestId("panel");
    pressInWindow(panel, { button: 0, clientY: 47, detail: 1 });
    expect(api.startDragging).toHaveBeenCalledOnce();
    pressInWindow(panel, { button: 0, clientY: 48, detail: 1 });
    pressInWindow(screen.getByRole("button"), {
      button: 0,
      clientY: 10,
      detail: 1,
    });
    expect(api.startDragging).toHaveBeenCalledOnce();
    // Slim-bar pages keep panels under the bar, which moves the window.
    document.documentElement.dataset.desktopSlimBar = "";
    pressInWindow(panel, { button: 0, clientY: 10, detail: 1 });
    expect(api.startDragging).toHaveBeenCalledOnce();
  });

  it("sets no overlay offset in a browser", () => {
    render(<DesktopTitleBar />);
    expect(
      document.documentElement.style.getPropertyValue("--desktop-frame-top"),
    ).toBe("");
  });

  it("shows restore while maximized and dims while in the background", async () => {
    const { emit } = enterDesktopApp("windows", { maximized: true });
    const { container } = render(<DesktopTitleBar />);
    expect(
      await screen.findByRole("button", {
        name: "navigation:desktopWindow.restore",
      }),
    ).toHaveAttribute("data-maximized", "true");

    emit({ maximized: false, focused: false, fullscreen: false });
    expect(
      screen.getByRole("button", { name: "navigation:desktopWindow.maximize" }),
    ).toHaveAttribute("data-maximized", "false");
    const controls = container.querySelector("[data-slot='window-controls']");
    expect(controls).toHaveAttribute("data-focused", "false");

    emit({ maximized: true, focused: true, fullscreen: false });
    expect(
      screen.getByRole("button", { name: "navigation:desktopWindow.restore" }),
    ).toBeInTheDocument();
    expect(controls).toHaveAttribute("data-focused", "true");
  });

  it("keeps the buttons reachable from the keyboard", () => {
    enterDesktopApp("windows");
    render(<DesktopTitleBar />);
    for (const name of ["minimize", "maximize", "close"]) {
      const button = screen.getByRole("button", {
        name: `navigation:desktopWindow.${name}`,
      });
      expect(button.tagName).toBe("BUTTON");
      expect(button).not.toHaveAttribute("tabindex", "-1");
      expect(button).toHaveAttribute("title");
    }
  });

  it("draws round window buttons on Linux, at the right of a slim bar", () => {
    const { api } = enterDesktopApp("linux");
    const { container } = render(<DesktopTitleBar />);
    const bar = container.querySelector(
      "[data-slot='desktop-title-bar']",
    ) as HTMLElement;
    expect(bar.style.height).toBe("36px");
    expect(document.documentElement.dataset.desktopTitlebar).toBe("linux");
    const controls = container.querySelector(
      "[data-slot='window-controls']",
    ) as HTMLElement;
    expect(controls).toHaveAttribute("data-platform", "linux");
    // The OS's side and order in every text direction.
    expect(controls.style.paddingRight).toBe("6px");
    expect(controls).toHaveAttribute("dir", "ltr");

    const close = screen.getByRole("button", {
      name: "navigation:desktopWindow.close",
    });
    expect(close.style.width).toBe("34px");
    expect(close.style.height).toBe("35px");
    expect(close.querySelector(".rounded-full")).not.toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "navigation:desktopWindow.minimize" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "navigation:desktopWindow.maximize" }),
    );
    fireEvent.click(close);
    expect(api.minimize).toHaveBeenCalledOnce();
    expect(api.toggleMaximize).toHaveBeenCalledOnce();
    expect(api.close).toHaveBeenCalledOnce();

    // The bar moves the window; the buttons never do.
    press(bar);
    press(close);
    expect(api.startDragging).toHaveBeenCalledOnce();
  });

  it("reserves the Linux buttons' width over the shell's top bar", async () => {
    const { emit } = enterDesktopApp("linux", { maximized: true });
    const { container } = render(
      <>
        <DesktopTitleBar />
        <Shell />
      </>,
    );
    expect(
      document.documentElement.style.getPropertyValue(
        "--desktop-controls-width",
      ),
    ).toBe("108px");
    const strip = container.querySelector(
      "[data-slot='desktop-overlay-drag']",
    ) as HTMLElement;
    expect(strip.style.right).toBe("108px");
    expect(
      container.querySelector("[data-slot='window-controls']"),
    ).toHaveClass("fixed", "top-0", "right-0", "z-(--z-window-controls)");
    expect(
      await screen.findByRole("button", {
        name: "navigation:desktopWindow.restore",
      }),
    ).toHaveAttribute("data-maximized", "true");
    emit({ maximized: false, focused: false, fullscreen: false });
    expect(
      container.querySelector("[data-slot='window-controls']"),
    ).toHaveAttribute("data-focused", "false");
  });

  it("leaves room for the traffic lights on macOS and draws no buttons", () => {
    enterDesktopApp("macos");
    const { container } = render(<DesktopTitleBar />);
    const bar = container.querySelector(
      "[data-slot='desktop-title-bar']",
    ) as HTMLElement;
    // The traffic lights stay at the left in every text direction.
    expect(bar.style.paddingLeft).toBe("78px");
    expect(bar).toHaveAttribute("dir", "ltr");
    expect(bar.style.height).toBe("48px");
    expect(screen.queryByRole("button", { name: /desktopWindow/ })).toBeNull();
    expect(
      document.documentElement.style.getPropertyValue("--desktop-inset-left"),
    ).toBe("78px");
    expect(document.documentElement.dataset.desktopTitlebar).toBe("macos");
  });
});

describe("window buttons beside app buttons", () => {
  it("marks off the buttons over the shell's top bar, not on a slim bar", () => {
    enterDesktopApp("windows");
    const slim = render(<DesktopTitleBar />);
    expect(
      slim.container.querySelector("[data-slot='window-controls']"),
    ).not.toHaveAttribute("data-separated");
    slim.unmount();

    const { container } = render(
      <>
        <DesktopTitleBar />
        <Shell />
      </>,
    );
    const controls = container.querySelector("[data-slot='window-controls']");
    expect(controls).toHaveAttribute("data-separated", "true");
    expect(controls).toHaveAttribute("dir", "ltr");
  });
});

describe("an element in full screen", () => {
  function enterFullscreen(element: Element | null) {
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => element,
    });
    act(() => {
      document.dispatchEvent(new Event("fullscreenchange"));
    });
  }

  afterEach(() => {
    Reflect.deleteProperty(document, "fullscreenElement");
  });

  it("keeps a slim bar with the window buttons inside it while the window is not full screen", () => {
    const { api, emit } = enterDesktopApp("windows");
    const { container } = render(
      <>
        <DesktopTitleBar />
        <Shell />
        <div data-testid="canvas" />
      </>,
    );
    expect(
      container.querySelector("[data-slot='desktop-fullscreen-bar']"),
    ).toBeNull();

    const canvas = screen.getByTestId("canvas");
    enterFullscreen(canvas);
    // Inside the full-screen element: outside it nothing takes a press.
    const bar = canvas.querySelector(
      "[data-slot='desktop-fullscreen-bar']",
    ) as HTMLElement;
    expect(bar).not.toBeNull();
    expect(bar.style.height).toBe("32px");
    expect(bar).toHaveClass("fixed", "top-0", "z-(--z-window-controls)");
    const root = document.documentElement;
    expect(root.dataset.desktopElementFullscreen).toBe("");
    expect(root.style.getPropertyValue("--desktop-fullscreen-bar-height")).toBe(
      "32px",
    );

    // Its buttons work and its empty space moves the window.
    const close = bar.querySelector(
      "[aria-label='navigation:desktopWindow.close']",
    ) as HTMLElement;
    fireEvent.click(close);
    expect(api.close).toHaveBeenCalledOnce();
    press(bar);
    expect(api.startDragging).toHaveBeenCalledOnce();

    // A window that went full screen itself needs no bar.
    emit({ maximized: false, focused: true, fullscreen: true });
    expect(canvas.querySelector("[data-slot='desktop-fullscreen-bar']")).toBe(
      null,
    );
    expect(root.dataset.desktopElementFullscreen).toBeUndefined();

    emit({ maximized: false, focused: true, fullscreen: false });
    expect(
      canvas.querySelector("[data-slot='desktop-fullscreen-bar']"),
    ).not.toBeNull();
    enterFullscreen(null);
    expect(
      document.querySelector("[data-slot='desktop-fullscreen-bar']"),
    ).toBeNull();
  });

  it("leaves a video or frame in full screen as it is", () => {
    enterDesktopApp("windows");
    render(<DesktopTitleBar />);
    const video = document.createElement("video");
    document.body.append(video);
    enterFullscreen(video);
    expect(
      document.querySelector("[data-slot='desktop-fullscreen-bar']"),
    ).toBeNull();
    video.remove();
  });

  it("ignores the whole page in full screen, and a browser", () => {
    enterFullscreen(document.documentElement);
    enterDesktopApp("windows");
    render(<DesktopTitleBar />);
    expect(
      document.querySelector("[data-slot='desktop-fullscreen-bar']"),
    ).toBeNull();
    cleanup();
    Reflect.deleteProperty(window, "__MARGAYA_DESKTOP__");
    enterFullscreen(document.body);
    render(<DesktopTitleBar />);
    expect(
      document.querySelector("[data-slot='desktop-fullscreen-bar']"),
    ).toBeNull();
  });
});

describe("window drag areas", () => {
  it("moves the window from empty space and text only", () => {
    const { api } = enterDesktopApp("windows");
    render(<DragBar />);
    const bar = screen.getByTestId("bar");
    expect(bar).toHaveAttribute("data-window-drag");

    press(bar);
    press(screen.getByTestId("title"));
    expect(api.startDragging).toHaveBeenCalledTimes(2);

    press(screen.getByRole("button", { name: "Search" }));
    press(screen.getByRole("link", { name: "Docs page" }));
    press(screen.getByRole("textbox", { name: "field" }));
    press(bar, { button: 2 });
    expect(api.startDragging).toHaveBeenCalledTimes(2);
    expect(api.toggleMaximize).not.toHaveBeenCalled();
  });

  it("maximizes or restores on a double-click", () => {
    const { api } = enterDesktopApp("windows");
    render(<DragBar />);
    press(screen.getByTestId("bar"), { detail: 2 });
    expect(api.toggleMaximize).toHaveBeenCalledOnce();
    expect(api.startDragging).not.toHaveBeenCalled();
    press(screen.getByRole("button", { name: "Search" }), { detail: 2 });
    expect(api.toggleMaximize).toHaveBeenCalledOnce();
  });
});
