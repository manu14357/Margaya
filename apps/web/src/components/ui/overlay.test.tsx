import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./alert-dialog";
import { CommandDialog, CommandDialogPopup } from "./command";
import { Dialog, DialogPopup, DialogTitle, DialogTrigger } from "./dialog";
import { OVERLAY_BACKDROP_CLASS, OVERLAY_VIEWPORT_CLASS } from "./overlay";
import { Sheet, SheetHeader, SheetPopup, SheetTitle } from "./sheet";

afterEach(cleanup);

const css = (file: string) =>
  readFileSync(join(import.meta.dirname, "..", "..", file), "utf8");
const indexCss = css("index.css");
const desktopCss = css("styles/desktop.css");

function expectSharedBackdrop(slot: string) {
  const backdrop = document.querySelector(`[data-slot="${slot}-backdrop"]`);
  expect(backdrop).not.toBeNull();
  expect(backdrop).toHaveAttribute("data-overlay-backdrop");
  // One token-driven dim on the window layer, never a blur.
  expect(backdrop).toHaveClass(
    "fixed",
    "inset-0",
    "z-(--z-overlay)",
    "bg-(--overlay-backdrop)",
  );
  expect(backdrop?.className).not.toMatch(/blur|bg-black/);
  const viewport = document.querySelector(`[data-slot="${slot}-viewport"]`);
  expect(viewport).toHaveClass(
    "pointer-events-none",
    "fixed",
    "inset-0",
    "z-(--z-overlay)",
  );
}

describe("overlay primitives", () => {
  it("share one backdrop and one layer, without blur", () => {
    expect(OVERLAY_BACKDROP_CLASS).not.toMatch(/blur/);
    expect(OVERLAY_BACKDROP_CLASS).toContain("bg-(--overlay-backdrop)");
    expect(OVERLAY_VIEWPORT_CLASS).toContain("z-(--z-overlay)");

    render(
      <Dialog open>
        <DialogPopup>
          <DialogTitle>Dialog</DialogTitle>
        </DialogPopup>
      </Dialog>,
    );
    expectSharedBackdrop("dialog");
    cleanup();

    render(
      <AlertDialog open>
        <AlertDialogPopup>
          <AlertDialogTitle>Confirm</AlertDialogTitle>
        </AlertDialogPopup>
      </AlertDialog>,
    );
    expectSharedBackdrop("alert-dialog");
    cleanup();

    render(
      <Sheet open>
        <SheetPopup>
          <SheetTitle>Sheet</SheetTitle>
        </SheetPopup>
      </Sheet>,
    );
    expectSharedBackdrop("sheet");
    cleanup();

    render(
      <CommandDialog open>
        <CommandDialogPopup aria-label="Palette" />
      </CommandDialog>,
    );
    expectSharedBackdrop("command-dialog");
  });

  it("hides the page behind from assistive tech, traps focus and returns it to the trigger", async () => {
    render(
      <>
        <header data-testid="behind">
          <button type="button">Search</button>
        </header>
        <Dialog>
          <DialogTrigger>Open</DialogTrigger>
          <DialogPopup>
            <DialogTitle>Dialog</DialogTitle>
            <input aria-label="Name" />
          </DialogPopup>
        </Dialog>
      </>,
    );
    const trigger = screen.getByRole("button", { name: "Open" });
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(dialog).toContainElement(document.activeElement as HTMLElement),
    );
    expect(
      screen.getByTestId("behind").closest("[aria-hidden=true]"),
    ).not.toBeNull();

    // Focus guards around the popup keep Tab inside it.
    expect(
      document.querySelectorAll("[data-base-ui-focus-guard]").length,
    ).toBeGreaterThanOrEqual(2);

    fireEvent.keyDown(document.activeElement as HTMLElement, {
      key: "Escape",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(trigger).toHaveFocus();
    expect(
      screen.getByTestId("behind").closest("[aria-hidden=true]"),
    ).toBeNull();
  });

  it("closes only the topmost overlay on Escape and keeps one backdrop painting", async () => {
    render(
      <Sheet open>
        <SheetPopup>
          <SheetTitle>Task</SheetTitle>
          <AlertDialog>
            <AlertDialogTrigger>Delete</AlertDialogTrigger>
            <AlertDialogPopup>
              <AlertDialogTitle>Delete this task?</AlertDialogTitle>
              <AlertDialogClose>Cancel</AlertDialogClose>
            </AlertDialogPopup>
          </AlertDialog>
        </SheetPopup>
      </Sheet>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const confirm = await screen.findByRole("alertdialog");
    const sheetBackdrop = document.querySelector(
      '[data-slot="sheet-backdrop"]',
    );
    const confirmBackdrop = document.querySelector(
      '[data-slot="alert-dialog-backdrop"]',
    );
    // The confirm's portal nests in the sheet's, after the sheet's backdrop,
    // which is what the "only the topmost paints" rule in index.css matches.
    expect(sheetBackdrop?.parentElement).toContainElement(
      confirmBackdrop as HTMLElement,
    );
    expect(
      sheetBackdrop?.compareDocumentPosition(confirmBackdrop as Node),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    await waitFor(() =>
      expect(confirm).toContainElement(document.activeElement as HTMLElement),
    );
    fireEvent.keyDown(document.activeElement as HTMLElement, {
      key: "Escape",
    });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("overlay tokens", () => {
  it("define the dim for light, dark and both high-contrast themes", () => {
    const dims = [
      ":root",
      ".dark",
      ".contrast:not(.dark)",
      ".dark.contrast",
    ].map((selector) => {
      const block = indexCss
        .split(`\n${selector} {`)
        .slice(1)
        .map((part) => part.slice(0, part.indexOf("\n}")))
        .find((part) => part.includes("--overlay-dim"));
      const match = block?.match(/--overlay-dim:\s*([0-9.]+);/);
      return match ? Number(match[1]) : Number.NaN;
    });
    for (const dim of dims) {
      expect(dim).toBeGreaterThanOrEqual(0.3);
      expect(dim).toBeLessThanOrEqual(0.7);
    }
    expect(indexCss).toMatch(
      /--overlay-backdrop:\s*rgb\(0 0 0 \/ var\(--overlay-dim\)\)/,
    );
  });

  it("order the window layers", () => {
    const z = (name: string) =>
      Number(indexCss.match(new RegExp(`--z-${name}:\\s*(\\d+);`))?.[1]);
    expect(z("floating")).toBeLessThan(z("overlay"));
    expect(z("overlay")).toBeLessThan(z("overlay-tools"));
    expect(z("overlay-tools")).toBeLessThan(z("toast"));
    expect(z("toast")).toBeLessThan(z("window-controls"));
  });

  it("let only the topmost open backdrop paint", () => {
    expect(indexCss).toContain(
      "~ [data-overlay-backdrop]:not([data-ending-style])",
    );
    expect(indexCss).toMatch(/--overlay-backdrop:\s*transparent;/);
  });

  it("dim the desktop title bar with the window, keeping the buttons usable", () => {
    // Backdrops are no longer pushed under the title bar line; popups are.
    expect(desktopCss).not.toMatch(
      /"(sheet|dialog|alert-dialog|command-dialog)-backdrop"/,
    );
    expect(desktopCss).toContain('[data-slot="dialog-viewport"]');
    // The buttons stay above the backdrop and darken by the same amount.
    expect(desktopCss).toMatch(
      /filter:\s*brightness\(calc\(1 - var\(--overlay-dim\)\)\)/,
    );
    expect(desktopCss).toContain('[data-slot="desktop-overlay-drag"]');
  });

  it("run desktop side panels full height, clear of the window buttons", () => {
    // Left and right panels start at the window's top edge in the shell.
    expect(desktopCss).toMatch(
      /:not\(\[data-desktop-slim-bar\]\)\s*\[data-slot="sheet-viewport"\]:is\(\[data-side="left"\], \[data-side="right"\]\) \{\s*top: 0;/,
    );
    // A right panel's rows reserve the buttons' width; a left one the
    // traffic lights.
    expect(desktopCss).toMatch(
      /--sheet-controls-inset: var\(--desktop-controls-width, 0px\);/,
    );
    expect(desktopCss).toMatch(
      /--sheet-start-inset: var\(--desktop-inset-left, 0px\);/,
    );
    // Over a right panel the buttons are not dimmed; over the dim they are.
    expect(desktopCss).toMatch(
      /\[data-overlay-backdrop\]:not\(\[data-ending-style\]\):not\(\[data-side="right"\]\)\s*\)\s*\[data-slot="window-controls"\]/,
    );
  });
});

describe("side panels in the desktop app", () => {
  function enterDesktopApp() {
    const api = {
      minimize: vi.fn(),
      toggleMaximize: vi.fn(),
      close: vi.fn(),
      startDragging: vi.fn(),
      isMaximized: vi.fn(async () => false),
      onStateChange: vi.fn(() => () => {}),
    };
    Object.defineProperty(window, "__MARGAYA_DESKTOP__", {
      configurable: true,
      value: {
        version: "0.2.0",
        platform: "windows",
        titleBar: {
          style: "custom",
          platform: "windows",
          leftInset: 0,
          rightInset: 0,
        },
        window: api,
      },
    });
    return api;
  }

  afterEach(() => {
    Reflect.deleteProperty(window, "__MARGAYA_DESKTOP__");
  });

  function renderPanel(side: "left" | "right" | "bottom" = "right") {
    render(
      <Sheet open>
        <SheetPopup side={side}>
          <SheetHeader>
            <SheetTitle>Task</SheetTitle>
            <button type="button">More</button>
          </SheetHeader>
        </SheetPopup>
      </Sheet>,
    );
    return document.querySelector('[data-slot="sheet-popup"]') as HTMLElement;
  }

  it("move the window from the empty top row, never from its buttons or lower down", () => {
    const api = enterDesktopApp();
    const popup = renderPanel();
    expect(popup).toHaveAttribute("data-side", "right");
    expect(
      document.querySelector('[data-slot="sheet-backdrop"]'),
    ).toHaveAttribute("data-side", "right");

    fireEvent.mouseDown(popup, { button: 0, clientY: 20, detail: 1 });
    expect(api.startDragging).toHaveBeenCalledOnce();
    fireEvent.mouseDown(popup, { button: 0, clientY: 20, detail: 2 });
    expect(api.toggleMaximize).toHaveBeenCalledOnce();

    fireEvent.mouseDown(popup, { button: 0, clientY: 120, detail: 1 });
    fireEvent.mouseDown(screen.getByRole("button", { name: "More" }), {
      button: 0,
      clientY: 20,
      detail: 1,
    });
    expect(api.startDragging).toHaveBeenCalledOnce();
  });

  it("put a drag gap beside the panel on the title bar line", () => {
    const api = enterDesktopApp();
    renderPanel("right");
    const gap = document.querySelector(
      '[data-slot="sheet-title-bar-gap"]',
    ) as HTMLElement;
    // Before the panel in the same row, so it fills the space to its left.
    const popup = document.querySelector('[data-slot="sheet-popup"]') as Node;
    expect(gap.parentElement).toBe(popup.parentElement);
    expect(gap.compareDocumentPosition(popup)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(gap).toHaveClass("h-(--desktop-frame-top)", "flex-1", "self-start");
    fireEvent.mouseDown(gap, { button: 0, detail: 1 });
    expect(api.startDragging).toHaveBeenCalledOnce();
    cleanup();

    renderPanel("left");
    const leftGap = document.querySelector(
      '[data-slot="sheet-title-bar-gap"]',
    ) as Node;
    expect(
      leftGap.compareDocumentPosition(
        document.querySelector('[data-slot="sheet-popup"]') as Node,
      ),
    ).toBe(Node.DOCUMENT_POSITION_PRECEDING);
    cleanup();

    // Bottom sheets (phones) keep their layout.
    renderPanel("bottom");
    expect(
      document.querySelector('[data-slot="sheet-title-bar-gap"]'),
    ).toBeNull();
  });

  it("change nothing in a browser", () => {
    const popup = renderPanel();
    expect(
      document.querySelector('[data-slot="sheet-title-bar-gap"]'),
    ).toBeNull();
    fireEvent.mouseDown(popup, { button: 0, clientY: 10, detail: 1 });
    // The header reserves the inset only where the desktop CSS sets it.
    expect(
      document.querySelector('[data-slot="sheet-header"]')?.className,
    ).toContain("pe-[calc(--spacing(6)+var(--sheet-controls-inset,0px))]");
  });
});
