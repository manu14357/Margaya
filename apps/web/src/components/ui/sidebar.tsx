"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { PanelLeftIcon } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";

/*
 * The app shell's context-panel state, plus the row primitives the panel
 * (and the settings navigation) are built from.
 *
 * - `open`: the panel is pinned beside the rail (desktop, >= 1024px).
 * - `openMobile`: the panel is shown as a drawer (below 1024px). The name is
 *   kept for compatibility; "mobile" here means "the panel is a drawer".
 * - `toggleSidebar()` flips whichever of the two applies at the current width.
 */

/** Below this width the context panel becomes an overlay drawer. */
export const PANEL_DRAWER_BREAKPOINT = 1024;

function subscribeToWidth(query: string) {
  return (onChange: () => void) => {
    if (typeof window === "undefined" || !window.matchMedia) return () => {};
    const mql = window.matchMedia(query);
    mql.addEventListener?.("change", onChange);
    return () => mql.removeEventListener?.("change", onChange);
  };
}

/** True while the viewport is narrower than `width`. SSR and jsdom: false. */
export function useIsBelowWidth(width: number) {
  const query = `(max-width: ${width - 1}px)`;
  const subscribe = React.useMemo(() => subscribeToWidth(query), [query]);
  return React.useSyncExternalStore(
    subscribe,
    () =>
      typeof window !== "undefined" && typeof window.innerWidth === "number"
        ? window.innerWidth < width
        : false,
    () => false,
  );
}

type SidebarContextProps = {
  state: "expanded" | "collapsed";
  open: boolean;
  setOpen: (open: boolean) => void;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  /** The panel is a drawer at this width (below 1024px). */
  isMobile: boolean;
  toggleSidebar: () => void;
};

const SidebarContext = React.createContext<SidebarContextProps | null>(null);

function useSidebar() {
  const context = React.useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.");
  }

  return context;
}

/** Like `useSidebar`, but null outside a provider (isolated tests, previews). */
function useOptionalSidebar() {
  return React.useContext(SidebarContext);
}

function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange: setOpenProp,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const isMobile = useIsBelowWidth(PANEL_DRAWER_BREAKPOINT);
  const [openMobile, setOpenMobile] = React.useState(false);
  const [_open, _setOpen] = React.useState(defaultOpen);
  const open = openProp ?? _open;

  const setOpen = React.useCallback(
    (value: boolean) => {
      if (setOpenProp) {
        setOpenProp(value);
      } else {
        _setOpen(value);
      }
    },
    [setOpenProp],
  );

  const toggleSidebar = React.useCallback(() => {
    if (isMobile) {
      setOpenMobile((current) => !current);
    } else {
      setOpen(!open);
    }
  }, [isMobile, open, setOpen]);

  // A drawer left open must not reappear when the window widens and shrinks.
  React.useEffect(() => {
    if (!isMobile) setOpenMobile(false);
  }, [isMobile]);

  const state = open ? "expanded" : "collapsed";

  const contextValue = React.useMemo<SidebarContextProps>(
    () => ({
      isMobile,
      open,
      openMobile,
      setOpen,
      setOpenMobile,
      state,
      toggleSidebar,
    }),
    [state, open, setOpen, isMobile, openMobile, toggleSidebar],
  );

  return (
    <SidebarContext.Provider value={contextValue}>
      <div
        className={cn("group/sidebar-wrapper flex h-full w-full", className)}
        data-slot="sidebar-wrapper"
        data-panel={open ? "open" : "closed"}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

function SidebarTrigger({
  className,
  onClick,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { t } = useTranslation();
  const sidebar = useOptionalSidebar();
  const pressed = sidebar
    ? sidebar.isMobile
      ? sidebar.openMobile
      : sidebar.open
    : false;

  return (
    <Button
      aria-pressed={pressed}
      className={cn("size-7", className)}
      data-sidebar="trigger"
      data-slot="sidebar-trigger"
      onClick={(event) => {
        onClick?.(event);
        sidebar?.toggleSidebar();
      }}
      size="icon"
      variant="ghost"
      {...props}
    >
      <PanelLeftIcon />
      <span className="sr-only">{t("common:a11y.toggleSidebar")}</span>
    </Button>
  );
}

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col gap-2 p-2", className)}
      data-sidebar="header"
      data-slot="sidebar-header"
      {...props}
    />
  );
}

function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col gap-2 p-2", className)}
      data-sidebar="footer"
      data-slot="sidebar-footer"
      {...props}
    />
  );
}

function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <ScrollArea
      className="**:data-[slot=scroll-area-scrollbar]:hidden"
      scrollFade
    >
      <div
        className={cn("flex min-h-0 flex-1 flex-col gap-2", className)}
        data-sidebar="content"
        data-slot="sidebar-content"
        {...props}
      />
    </ScrollArea>
  );
}

function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("relative flex w-full min-w-0 flex-col p-2", className)}
      data-sidebar="group"
      data-slot="sidebar-group"
      {...props}
    />
  );
}

function SidebarGroupLabel({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">) {
  const defaultProps = {
    className: cn(
      "flex h-7 shrink-0 items-center rounded-md px-2 font-medium text-[11px] text-sidebar-foreground uppercase tracking-wide outline-hidden ring-sidebar-ring focus-visible:ring-2 [&>svg]:size-3.5 [&>svg]:shrink-0",
      className,
    ),
    "data-sidebar": "group-label",
    "data-slot": "sidebar-group-label",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps(defaultProps, props),
    render,
  });
}

function SidebarGroupContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("w-full text-sm", className)}
      data-sidebar="group-content"
      data-slot="sidebar-group-content"
      {...props}
    />
  );
}

function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      className={cn("flex w-full min-w-0 flex-col gap-px", className)}
      data-sidebar="menu"
      data-slot="sidebar-menu"
      {...props}
    />
  );
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      className={cn("group/menu-item relative", className)}
      data-sidebar="menu-item"
      data-slot="sidebar-menu-item"
      {...props}
    />
  );
}

// Compact panel rows: 30px, a soft fill on hover and a `secondary` fill plus
// a 2px primary marker on the current row.
const sidebarMenuButtonVariants = cva(
  "peer/menu-button relative flex w-full cursor-pointer items-center gap-2 overflow-hidden rounded-md px-2 text-left text-sidebar-foreground outline-hidden ring-sidebar-ring transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 group-has-data-[sidebar=menu-action]/menu-item:pe-8 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground data-[active=true]:before:absolute data-[active=true]:before:inset-y-1.5 data-[active=true]:before:left-0 data-[active=true]:before:w-0.5 data-[active=true]:before:rounded-full data-[active=true]:before:bg-sidebar-primary data-[state=open]:hover:bg-sidebar-accent data-[state=open]:hover:text-sidebar-accent-foreground [&>span:last-child]:truncate [&>svg:not([class*='size-'])]:size-4 [&>svg]:shrink-0",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        default: "h-7.5 text-[13px]",
        lg: "h-10 text-sm",
        sm: "h-7 text-xs",
      },
      variant: {
        default: "",
        outline:
          "bg-background shadow-[0_0_0_1px_var(--sidebar-border)] hover:shadow-[0_0_0_1px_var(--sidebar-accent)]",
      },
    },
  },
);

function SidebarMenuButton({
  isActive = false,
  variant = "default",
  size = "default",
  tooltip,
  className,
  render,
  ...props
}: useRender.ComponentProps<"button"> & {
  isActive?: boolean;
  tooltip?: string | React.ComponentProps<typeof TooltipPopup>;
} & VariantProps<typeof sidebarMenuButtonVariants>) {
  const defaultProps = {
    className: cn(sidebarMenuButtonVariants({ size, variant }), className),
    "data-active": isActive,
    "aria-current": isActive ? ("page" as const) : undefined,
    "data-sidebar": "menu-button",
    "data-size": size,
    "data-slot": "sidebar-menu-button",
  };

  const buttonProps = mergeProps<"button">(defaultProps, props);

  const buttonElement = useRender({
    defaultTagName: "button",
    props: buttonProps,
    render,
  });

  if (!tooltip) {
    return buttonElement;
  }

  const popupProps =
    typeof tooltip === "string" ? { children: tooltip } : tooltip;

  return (
    <Tooltip>
      <TooltipTrigger
        render={buttonElement as React.ReactElement<Record<string, unknown>>}
      />
      <TooltipPopup align="center" side="right" {...popupProps} />
    </Tooltip>
  );
}

export {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useOptionalSidebar,
  useSidebar,
};
