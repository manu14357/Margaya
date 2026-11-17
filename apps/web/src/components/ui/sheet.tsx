"use client";

import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";
import { PanelLeftClose, PanelRightClose, XIcon } from "lucide-react";
import {
  createContext,
  type MouseEvent,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import {
  useDesktopDragRegion,
  useDesktopTopRowDrag,
} from "@/components/desktop/desktop-title-bar";
import { Button } from "@/components/ui/button";
import {
  OVERLAY_BACKDROP_CLASS,
  OVERLAY_VIEWPORT_CLASS,
  overlayBackdropProps,
} from "@/components/ui/overlay";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/cn";
import { i18n } from "@/lib/i18n";

const Sheet = SheetPrimitive.Root;

const SheetPortal = SheetPrimitive.Portal;

function SheetTrigger(props: SheetPrimitive.Trigger.Props) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose(props: SheetPrimitive.Close.Props) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

type SheetSide = "right" | "left" | "top" | "bottom";

const SheetContext = createContext<{
  side: SheetSide;
  /** A header bar with its own close panel: the popup drops its fallback. */
  registerHeaderBar: () => () => void;
} | null>(null);

/** The open sheet around a component (its side), or null outside one. */
function useSheetContext() {
  return useContext(SheetContext);
}

function SheetBackdrop({
  className,
  side,
  ...props
}: SheetPrimitive.Backdrop.Props & { side?: SheetSide }) {
  return (
    <SheetPrimitive.Backdrop
      className={cn(OVERLAY_BACKDROP_CLASS, className)}
      data-slot="sheet-backdrop"
      data-side={side}
      {...overlayBackdropProps}
      {...props}
    />
  );
}

/**
 * Desktop app only: the dimmed title bar beside a full-height side panel.
 * It fills the viewport row next to the panel, as tall as the title bar, so
 * a press there moves the window (a double-click maximizes) instead of
 * closing the panel. Nothing in a browser; hidden on slim-bar pages, where
 * panels start under the bar (desktop.css).
 */
function SheetTitleBarGap() {
  const dragRegion = useDesktopDragRegion();
  if (!("onMouseDown" in dragRegion)) return null;
  return (
    <div
      {...dragRegion}
      aria-hidden="true"
      className="h-(--desktop-frame-top) min-w-0 flex-1 self-start"
      data-slot="sheet-title-bar-gap"
    />
  );
}

function SheetViewport({
  className,
  side,
  variant = "default",
  ...props
}: SheetPrimitive.Viewport.Props & {
  side?: SheetSide;
  variant?: "default" | "inset";
}) {
  return (
    <SheetPrimitive.Viewport
      className={cn(
        OVERLAY_VIEWPORT_CLASS,
        "grid",
        side === "bottom" && "grid grid-rows-[1fr_auto] pt-12",
        side === "top" && "grid grid-rows-[auto_1fr] pb-12",
        side === "left" && "flex justify-start",
        side === "right" && "flex justify-end",
        variant === "inset" && "sm:p-4",
      )}
      data-slot="sheet-viewport"
      data-side={side}
      {...props}
    />
  );
}

function SheetPopup({
  className,
  children,
  showCloseButton = true,
  side = "right",
  variant = "default",
  onMouseDown,
  ...props
}: SheetPrimitive.Popup.Props & {
  showCloseButton?: boolean;
  side?: SheetSide;
  variant?: "default" | "inset";
}) {
  // In the desktop app a side panel runs the window's full height, so its
  // top row is the title bar there: its empty space moves the window.
  const topRowDrag = useDesktopTopRowDrag();
  const sidePanel = side === "left" || side === "right";
  const [headerBars, setHeaderBars] = useState(0);
  const registerHeaderBar = useCallback(() => {
    setHeaderBars((count) => count + 1);
    return () => setHeaderBars((count) => count - 1);
  }, []);
  const context = useMemo(
    () => ({ side, registerHeaderBar }),
    [side, registerHeaderBar],
  );
  return (
    <SheetPortal>
      <SheetBackdrop side={side} />
      <SheetViewport side={side} variant={variant}>
        {side === "right" && <SheetTitleBarGap />}
        <SheetPrimitive.Popup
          className={cn(
            "relative flex max-h-full min-h-0 w-full min-w-0 flex-col bg-popover not-dark:bg-clip-padding text-popover-foreground shadow-lg/5 transition-[opacity,translate] duration-200 ease-out will-change-transform before:pointer-events-none before:absolute before:inset-0 before:shadow-[0_1px_--theme(--color-black/4%)] data-ending-style:opacity-0 data-starting-style:opacity-0 max-sm:before:hidden dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
            side === "bottom" &&
              "row-start-2 border-t data-ending-style:translate-y-8 data-starting-style:translate-y-8",
            side === "top" &&
              "data-ending-style:-translate-y-8 data-starting-style:-translate-y-8 border-b",
            side === "left" &&
              "data-ending-style:-translate-x-8 data-starting-style:-translate-x-8 w-[calc(100%-(--spacing(12)))] max-w-md border-e",
            side === "right" &&
              "col-start-2 w-[calc(100%-(--spacing(12)))] max-w-md border-s data-ending-style:translate-x-8 data-starting-style:translate-x-8",
            variant === "inset" &&
              "before:hidden sm:rounded-2xl sm:border sm:before:rounded-[calc(var(--radius-2xl)-1px)] sm:**:data-[slot=sheet-footer]:rounded-b-[calc(var(--radius-2xl)-1px)]",
            className,
          )}
          data-slot="sheet-popup"
          data-side={side}
          onMouseDown={(event: MouseEvent<HTMLDivElement>) => {
            onMouseDown?.(event as never);
            if (sidePanel) topRowDrag.onMouseDown?.(event);
          }}
          {...props}
        >
          <SheetContext.Provider value={context}>
            {children}
          </SheetContext.Provider>
          {showCloseButton &&
            headerBars === 0 &&
            (sidePanel ? (
              // A side panel closes with a panel glyph, never an X (that
              // closes dialogs and the window). Panels built on
              // SheetHeaderBar carry their own, so this one steps aside;
              // in the shell it sits under the title row (desktop.css).
              <SheetPrimitive.Close
                aria-label={i18n.t("common:actions.closePanel")}
                title={i18n.t("common:actions.closePanel")}
                className="absolute end-2 top-[calc(--spacing(2)+var(--sheet-title-row,0px))]"
                data-slot="sheet-close"
                render={<Button size="icon" variant="ghost" />}
              >
                {side === "left" ? (
                  <PanelLeftClose className="rtl:-scale-x-100" />
                ) : (
                  <PanelRightClose className="rtl:-scale-x-100" />
                )}
              </SheetPrimitive.Close>
            ) : (
              <SheetPrimitive.Close
                aria-label={i18n.t("common:actions.close")}
                className="absolute end-2 top-2"
                data-slot="sheet-close"
                render={<Button size="icon" variant="ghost" />}
              >
                <XIcon />
              </SheetPrimitive.Close>
            ))}
        </SheetPrimitive.Popup>
        {side === "left" && <SheetTitleBarGap />}
      </SheetViewport>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        // The insets keep it clear of the desktop window buttons and the
        // macOS traffic lights when the panel's top row is the title bar.
        "flex flex-col gap-2 p-6 ps-[calc(--spacing(6)+var(--sheet-start-inset,0px))] pe-[calc(--spacing(6)+var(--sheet-controls-inset,0px))] in-[[data-slot=sheet-popup]:has([data-slot=sheet-panel])]:pb-3 max-sm:pb-4",
        className,
      )}
      data-slot="sheet-header"
      {...props}
    />
  );
}

function SheetFooter({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & {
  variant?: "default" | "bare";
}) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse gap-2 px-6 sm:flex-row sm:justify-end",
        variant === "default" && "border-t bg-muted/72 py-4",
        variant === "bare" &&
          "in-[[data-slot=sheet-popup]:has([data-slot=sheet-panel])]:pt-3 pt-4 pb-6",
        className,
      )}
      data-slot="sheet-footer"
      {...props}
    />
  );
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
  return (
    <SheetPrimitive.Title
      className={cn(
        "font-heading font-semibold text-xl leading-none",
        className,
      )}
      data-slot="sheet-title"
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: SheetPrimitive.Description.Props) {
  return (
    <SheetPrimitive.Description
      className={cn("text-muted-foreground text-sm", className)}
      data-slot="sheet-description"
      {...props}
    />
  );
}

function SheetPanel({
  className,
  scrollFade = true,
  ...props
}: React.ComponentProps<"div"> & { scrollFade?: boolean }) {
  return (
    <ScrollArea scrollFade={scrollFade}>
      <div
        className={cn(
          "p-6 in-[[data-slot=sheet-popup]:has([data-slot=sheet-header])]:pt-1 in-[[data-slot=sheet-popup]:has([data-slot=sheet-footer]:not(.border-t))]:pb-1",
          className,
        )}
        data-slot="sheet-panel"
        {...props}
      />
    </ScrollArea>
  );
}

export {
  Sheet,
  SheetBackdrop,
  SheetBackdrop as SheetOverlay,
  SheetClose,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetPopup as SheetContent,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
  useSheetContext,
};
