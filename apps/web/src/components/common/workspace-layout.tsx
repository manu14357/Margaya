import type { ReactNode } from "react";
import Layout from "@/components/common/layout";
import { cn } from "@/lib/cn";

type WorkspaceLayoutProps = {
  /** The page's name: the top bar's place. */
  title: string;
  /** The top bar's primary-action slot. */
  headerActions?: ReactNode;
  children: ReactNode;
  /** @deprecated Unused; kept so existing callers compile. */
  onCreateProject?: () => void;
  /** Classes for the actions container. */
  className?: string;
};

/** A workspace-level page: the top bar (title + actions), then the body. */
export default function WorkspaceLayout({
  title,
  headerActions,
  children,
  className,
}: WorkspaceLayoutProps) {
  return (
    <Layout>
      <Layout.TopBar
        title={title}
        actions={
          headerActions ? (
            <div className={cn("flex items-center gap-1.5", className)}>
              {headerActions}
            </div>
          ) : undefined
        }
      />
      <Layout.Content>{children}</Layout.Content>
    </Layout>
  );
}
