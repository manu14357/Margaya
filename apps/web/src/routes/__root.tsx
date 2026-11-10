import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { DesktopTitleBar } from "@/components/desktop/desktop-title-bar";
import { ToastProvider } from "@/components/ui/toast";
import type { User } from "@/types/user";

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
  user: User | null | undefined;
}>()({
  component: RootComponent,
});

function RootComponent() {
  return (
    <ToastProvider position="bottom-right">
      {/* Desktop app's frameless window only; nothing in a browser. */}
      <DesktopTitleBar />
      <div className="flex h-svh w-full flex-row overflow-x-hidden overflow-y-hidden bg-background scrollbar-thin scrollbar-thumb-border scrollbar-track-muted">
        <Outlet />
      </div>
    </ToastProvider>
  );
}

export default RootComponent;
