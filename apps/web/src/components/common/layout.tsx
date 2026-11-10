import type { ReactNode } from "react";
import { ContentArea } from "@/components/common/content-area";
import { FilterBar } from "@/components/common/filter-bar";
import { TopBar } from "@/components/common/header/top-bar";
import { PageHeader } from "@/components/common/page-header";
import { SplitView } from "@/components/common/split-view";
import { ViewTabs } from "@/components/common/view-tabs";
import {
  useDesktopDragRegion,
  useDesktopTitleBar,
} from "@/components/desktop/desktop-title-bar";
import { cn } from "@/lib/cn";

type LayoutProps = {
  children: ReactNode;
  className?: string;
};

type HeaderProps = {
  children: ReactNode;
  className?: string;
};

type ContentProps = {
  children: ReactNode;
  className?: string;
};

/**
 * A free-form header row. Prefer `Layout.TopBar` (the shell's top bar with
 * the command field); this stays for pages that compose their own row.
 */
function LayoutHeader({ children, className }: HeaderProps) {
  // The desktop app's title bar line, as in TopBar.
  const titleBar = useDesktopTitleBar();
  const dragRegion = useDesktopDragRegion();
  return (
    <header
      {...dragRegion}
      className={cn(
        "flex h-12 shrink-0 items-center gap-2 border-border/80 border-b bg-background px-2 md:px-3",
        titleBar &&
          "pe-[calc(var(--desktop-controls-width,0px)+0.5rem)] max-md:ps-[max(0.5rem,var(--desktop-inset-left,0px))]",
        className,
      )}
      data-slot="layout-header"
    >
      {children}
    </header>
  );
}

/**
 * The page body: fills the remaining height. A child that sizes itself to
 * `h-full` manages its own scroll; taller content scrolls here, under the
 * fixed top bar.
 */
function LayoutContent({ children, className }: ContentProps) {
  return (
    <div className={cn("min-h-0 flex-1 overflow-auto", className)}>
      <div className="h-full">{children}</div>
    </div>
  );
}

/**
 * A page frame inside the app shell (the shell itself is mounted once by the
 * dashboard route). Stack, top to bottom:
 *
 *   <Layout>
 *     <Layout.TopBar title=… actions=… />
 *     <Layout.ViewTabs … />        optional
 *     <Layout.FilterBar … />       optional
 *     <Layout.ContentArea> … </Layout.ContentArea>   or Layout.Content
 *   </Layout>
 *
 * See components/common/README.md.
 */
function Layout({ children, className }: LayoutProps) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 w-full min-w-0 flex-col bg-background",
        className,
      )}
      data-slot="page-frame"
    >
      {children}
    </div>
  );
}

Layout.Header = LayoutHeader;
Layout.Content = LayoutContent;
Layout.TopBar = TopBar;
Layout.ViewTabs = ViewTabs;
Layout.FilterBar = FilterBar;
Layout.PageHeader = PageHeader;
Layout.ContentArea = ContentArea;
Layout.SplitView = SplitView;

export default Layout;
