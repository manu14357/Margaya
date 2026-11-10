import {
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { create } from "zustand";
import { cn } from "@/lib/cn";
import {
  DESKTOP_WINDOW_STATE_EVENT,
  type DesktopWindowState,
  getDesktopTitleBar,
  getDesktopWindow,
  type DesktopTitleBar as TitleBarSettings,
} from "@/lib/desktop";

/**
 * Margaya Desktop's frameless window. With `titleBar.style === "custom"` the
 * app draws no title bar, so the web app's own top bar is the window's title
 * bar: its empty space moves the window, a double-click maximizes, and on
 * Windows and Linux the minimize, maximize and close buttons sit at its far
 * right (Windows 11 caption buttons, or round GNOME-like ones on Linux). On
 * macOS the traffic lights sit over the rail's top, `leftInset` wide.
 *
 * Pages without the app shell (sign-in, onboarding, errors) get a slim bar
 * of their own, so the window can always be moved and closed.
 */

/** The shell's top bar height (TopBar is h-12). */
export const SHELL_BAR_HEIGHT = 48;
/** Windows 11 caption buttons: 46px wide each. */
export const WINDOW_BUTTON_WIDTH = 46;
/** Linux: a 24px round button in a 34px wide target each, then 6px of room. */
export const LINUX_BUTTON_WIDTH = 34;
const LINUX_END_PADDING = 6;

/** The room the window buttons take at the right of the bar. */
export function windowControlsWidth(platform: TitleBarSettings["platform"]) {
  if (platform === "windows") return WINDOW_BUTTON_WIDTH * 3;
  if (platform === "linux") return LINUX_BUTTON_WIDTH * 3 + LINUX_END_PADDING;
  return 0;
}

/** The slim bar on pages without the shell; macOS matches the traffic lights. */
export function slimBarHeight(platform: TitleBarSettings["platform"]) {
  if (platform === "macos") return SHELL_BAR_HEIGHT;
  return platform === "linux" ? 36 : 32;
}

/** Whether the app shell (and with it the top bar) is on screen. */
const useShellFrame = create<{
  mounted: number;
  change: (delta: number) => void;
}>((set) => ({
  mounted: 0,
  change: (delta) => set((state) => ({ mounted: state.mounted + delta })),
}));

/** Mounted by the app shell: its top bar is the title bar while it shows. */
export function useDesktopShellFrame() {
  const change = useShellFrame((state) => state.change);
  useEffect(() => {
    change(1);
    return () => change(-1);
  }, [change]);
}

/** The custom title bar's settings, or null (browser or native frame). */
export function useDesktopTitleBar(): TitleBarSettings | null {
  // The bridge is injected before the page loads and never changes.
  const [titleBar] = useState(() => getDesktopTitleBar());
  return titleBar;
}

/** The window's maximized and focused state, kept current by the app. */
export function useDesktopWindowState(): DesktopWindowState {
  const [state, setState] = useState<DesktopWindowState>(() => ({
    maximized: false,
    focused: typeof document === "undefined" ? true : document.hasFocus(),
    fullscreen: false,
  }));

  useEffect(() => {
    const api = getDesktopWindow();
    let active = true;
    const apply = (next: Partial<DesktopWindowState> | null | undefined) => {
      if (!active || typeof next !== "object" || next === null) return;
      setState((current) => ({
        maximized:
          typeof next.maximized === "boolean"
            ? next.maximized
            : current.maximized,
        focused:
          typeof next.focused === "boolean" ? next.focused : current.focused,
        fullscreen:
          typeof next.fullscreen === "boolean"
            ? next.fullscreen
            : current.fullscreen,
      }));
    };

    if (typeof api?.isMaximized === "function") {
      api.isMaximized().then(
        (maximized) => apply({ maximized }),
        () => {},
      );
    }

    let unsubscribe: () => void = () => {};
    if (typeof api?.onStateChange === "function") {
      const result = api.onStateChange(apply);
      if (typeof result === "function") unsubscribe = result;
    } else {
      const onEvent = (event: Event) =>
        apply((event as CustomEvent<Partial<DesktopWindowState>>).detail);
      window.addEventListener(DESKTOP_WINDOW_STATE_EVENT, onEvent);
      unsubscribe = () =>
        window.removeEventListener(DESKTOP_WINDOW_STATE_EVENT, onEvent);
    }

    // The page's own focus events agree with the window's.
    const onFocus = () => apply({ focused: true });
    const onBlur = () => apply({ focused: false });
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);

    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  return state;
}

/** What a press may land on without moving the window. */
const INTERACTIVE = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "label",
  "summary",
  "[contenteditable]",
  "[role='button']",
  "[role='link']",
  "[role='menuitem']",
  "[role='tab']",
  "[role='combobox']",
  "[role='switch']",
  "[role='checkbox']",
  "[role='slider']",
  "[tabindex]:not([tabindex='-1'])",
  "[data-no-window-drag]",
].join(",");

export function isWindowDragTarget(target: EventTarget | null) {
  return target instanceof Element && target.closest(INTERACTIVE) === null;
}

/**
 * Props that make an element a window drag area inside the desktop app's
 * custom frame: a press on its empty space moves the window, a double-click
 * maximizes or restores it. Buttons, fields, links and menus inside keep
 * working. An empty object everywhere else.
 */
export function useDesktopDragRegion() {
  const titleBar = useDesktopTitleBar();
  if (!titleBar) return {};
  return {
    "data-window-drag": "",
    onMouseDown: (event: MouseEvent<HTMLElement>) => {
      if (event.button !== 0 || !isWindowDragTarget(event.target)) return;
      const api = getDesktopWindow();
      // Keep the press from starting a text selection in the bar.
      event.preventDefault();
      if (event.detail >= 2) api?.toggleMaximize?.();
      else api?.startDragging?.();
    },
  };
}

function Glyph({
  children,
  strokeWidth = 1,
}: {
  children: ReactNode;
  strokeWidth?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap={strokeWidth > 1 ? "round" : undefined}
      className="pointer-events-none"
    >
      {children}
    </svg>
  );
}

/**
 * The window buttons: minimize, maximize or restore, close. On Windows the
 * Windows 11 caption buttons: full bar height, 46px wide, a quiet hover, red
 * close. On Linux round buttons like GNOME's: a 24px circle in a 34px wide
 * target, a neutral close. Both dim while the window is in the background.
 */
export function WindowControls({
  height,
  className,
  platform = "windows",
}: {
  height: number;
  className?: string;
  platform?: TitleBarSettings["platform"];
}) {
  if (platform === "linux")
    return <LinuxWindowControls height={height} className={className} />;
  return <WindowsWindowControls height={height} className={className} />;
}

function WindowsWindowControls({
  height,
  className,
}: {
  height: number;
  className?: string;
}) {
  const { t } = useTranslation();
  const { maximized, focused } = useDesktopWindowState();
  const api = getDesktopWindow();
  const button =
    "flex shrink-0 cursor-default items-center justify-center outline-hidden transition-colors duration-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";
  const quiet =
    "text-foreground/85 hover:bg-foreground/[0.07] hover:text-foreground active:bg-foreground/[0.04] group-data-[focused=false]/controls:text-muted-foreground/70 group-data-[focused=false]/controls:hover:text-foreground";
  const size: CSSProperties = { width: WINDOW_BUTTON_WIDTH, height };
  const maximizeLabel = maximized
    ? t("navigation:desktopWindow.restore")
    : t("navigation:desktopWindow.maximize");

  return (
    <div
      className={cn("group/controls flex items-stretch", className)}
      data-focused={focused}
      data-slot="window-controls"
      data-no-window-drag=""
    >
      <button
        type="button"
        className={cn(button, quiet)}
        style={size}
        aria-label={t("navigation:desktopWindow.minimize")}
        title={t("navigation:desktopWindow.minimize")}
        onClick={() => api?.minimize?.()}
      >
        <Glyph>
          <path d="M0 5.5h10" shapeRendering="crispEdges" />
        </Glyph>
      </button>
      <button
        type="button"
        className={cn(button, quiet)}
        style={size}
        aria-label={maximizeLabel}
        title={maximizeLabel}
        data-maximized={maximized}
        onClick={() => api?.toggleMaximize?.()}
      >
        {maximized ? (
          <Glyph>
            <rect
              x="0.5"
              y="2.5"
              width="7"
              height="7"
              shapeRendering="crispEdges"
            />
            <path d="M2.5 2.5V0.5h7v7h-2" shapeRendering="crispEdges" />
          </Glyph>
        ) : (
          <Glyph>
            <rect
              x="0.5"
              y="0.5"
              width="9"
              height="9"
              shapeRendering="crispEdges"
            />
          </Glyph>
        )}
      </button>
      <button
        type="button"
        className={cn(
          button,
          "text-foreground/85 hover:bg-(--titlebar-close-hover) hover:text-(--titlebar-close-foreground) active:bg-(--titlebar-close-active) active:text-(--titlebar-close-foreground) group-data-[focused=false]/controls:text-muted-foreground/70",
        )}
        style={size}
        aria-label={t("navigation:desktopWindow.close")}
        title={t("navigation:desktopWindow.close")}
        onClick={() => api?.close?.()}
      >
        <Glyph>
          <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
        </Glyph>
      </button>
    </div>
  );
}

/** GNOME-like round window buttons, for Linux. */
function LinuxWindowControls({
  height,
  className,
}: {
  height: number;
  className?: string;
}) {
  const { t } = useTranslation();
  const { maximized, focused } = useDesktopWindowState();
  const api = getDesktopWindow();
  const button =
    "group/button flex shrink-0 cursor-default items-center justify-center outline-hidden";
  const circle =
    "flex size-6 items-center justify-center rounded-full bg-foreground/[0.08] text-foreground/85 transition-colors duration-100 group-hover/button:bg-foreground/[0.14] group-hover/button:text-foreground group-active/button:bg-foreground/[0.22] group-focus-visible/button:ring-2 group-focus-visible/button:ring-ring group-data-[focused=false]/controls:bg-foreground/[0.05] group-data-[focused=false]/controls:text-muted-foreground/70";
  const size: CSSProperties = { width: LINUX_BUTTON_WIDTH, height };
  const maximizeLabel = maximized
    ? t("navigation:desktopWindow.restore")
    : t("navigation:desktopWindow.maximize");
  const buttons = [
    {
      label: t("navigation:desktopWindow.minimize"),
      onClick: () => api?.minimize?.(),
      glyph: <path d="M2 7.5h6" />,
    },
    {
      label: maximizeLabel,
      onClick: () => api?.toggleMaximize?.(),
      maximized,
      glyph: maximized ? (
        <>
          <rect x="1.5" y="3.5" width="5" height="5" rx="0.5" />
          <path d="M3.5 1.5h5v5" />
        </>
      ) : (
        <rect x="1.75" y="1.75" width="6.5" height="6.5" rx="0.75" />
      ),
    },
    {
      label: t("navigation:desktopWindow.close"),
      onClick: () => api?.close?.(),
      glyph: <path d="M2.5 2.5l5 5M7.5 2.5l-5 5" />,
    },
  ];

  return (
    <div
      className={cn("group/controls flex items-stretch", className)}
      style={{ paddingInlineEnd: LINUX_END_PADDING }}
      data-focused={focused}
      data-platform="linux"
      data-slot="window-controls"
      data-no-window-drag=""
    >
      {buttons.map((item) => (
        <button
          key={item.label}
          type="button"
          className={button}
          style={size}
          aria-label={item.label}
          title={item.label}
          data-maximized={"maximized" in item ? item.maximized : undefined}
          onClick={item.onClick}
        >
          <span className={circle}>
            <Glyph strokeWidth={1.5}>{item.glyph}</Glyph>
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * Mounted once at the root. Publishes the frame's measurements as CSS
 * variables for the shell, and draws what the current page needs: the
 * window buttons (Windows, Linux) over the shell's top bar, or a whole slim
 * bar.
 */
export function DesktopTitleBar() {
  const titleBar = useDesktopTitleBar();
  const shellMounted = useShellFrame((state) => state.mounted > 0);
  const dragRegion = useDesktopDragRegion();
  const slim = Boolean(titleBar) && !shellMounted;
  const platform = titleBar?.platform;
  // Windows and Linux draw their buttons here; macOS has the traffic lights.
  const controls = platform === "windows" || platform === "linux";
  const controlsWidth = platform ? windowControlsWidth(platform) : 0;
  const slimHeight = titleBar ? slimBarHeight(titleBar.platform) : 0;

  useEffect(() => {
    if (!titleBar) return;
    const root = document.documentElement;
    root.dataset.desktopTitlebar = titleBar.platform;
    root.style.setProperty("--desktop-inset-left", `${titleBar.leftInset}px`);
    root.style.setProperty(
      "--desktop-controls-width",
      `${controls ? controlsWidth : titleBar.rightInset}px`,
    );
    return () => {
      delete root.dataset.desktopTitlebar;
      root.style.removeProperty("--desktop-inset-left");
      root.style.removeProperty("--desktop-controls-width");
    };
  }, [titleBar, controls, controlsWidth]);

  useEffect(() => {
    if (!slim) return;
    const root = document.documentElement;
    root.dataset.desktopSlimBar = "";
    root.style.setProperty("--desktop-slim-bar-height", `${slimHeight}px`);
    return () => {
      delete root.dataset.desktopSlimBar;
      root.style.removeProperty("--desktop-slim-bar-height");
    };
  }, [slim, slimHeight]);

  // Overlays (sheets, dialogs, the palette) start under the title bar line,
  // so the window buttons and the traffic lights stay in reach (desktop.css).
  const frameTop = slim ? slimHeight : SHELL_BAR_HEIGHT;
  useEffect(() => {
    if (!titleBar) return;
    const root = document.documentElement;
    root.style.setProperty("--desktop-frame-top", `${frameTop}px`);
    return () => {
      root.style.removeProperty("--desktop-frame-top");
    };
  }, [titleBar, frameTop]);

  if (!titleBar) return null;

  // While a sheet or dialog dims the page, this strip over the title bar
  // line keeps moving the window (desktop.css shows it only then).
  const overlayDrag = (
    <div
      {...dragRegion}
      aria-hidden="true"
      className="fixed top-0 left-0 z-55 hidden"
      style={{
        height: frameTop,
        right: controls ? controlsWidth : 0,
      }}
      data-slot="desktop-overlay-drag"
    />
  );

  if (!slim) {
    // The shell's top bar is the drag area and reserves this corner.
    return (
      <>
        {overlayDrag}
        {controls && (
          <WindowControls
            platform={platform}
            height={SHELL_BAR_HEIGHT - 1}
            className="fixed top-0 right-0 z-60"
          />
        )}
      </>
    );
  }

  return (
    <>
      {overlayDrag}
      <div
        {...dragRegion}
        className="relative z-40 flex w-full shrink-0 items-stretch border-border/60 border-b bg-background"
        style={{ height: slimHeight, paddingInlineStart: titleBar.leftInset }}
        data-slot="desktop-title-bar"
      >
        <span className="flex min-w-0 flex-1 items-center px-3">
          {controls && (
            <>
              <img
                src="/logo-dark.svg"
                alt=""
                className="h-3.5 w-auto opacity-70 dark:hidden"
              />
              <img
                src="/logo-light.svg"
                alt=""
                className="hidden h-3.5 w-auto opacity-70 dark:block"
              />
            </>
          )}
        </span>
        {controls && (
          <WindowControls platform={platform} height={slimHeight - 1} />
        )}
      </div>
    </>
  );
}
