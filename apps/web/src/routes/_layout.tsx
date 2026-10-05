import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useState } from "react";
import CommandPalette from "@/components/command-palette";
import SearchCommandMenu from "@/components/search-command-menu";
import CopyTaskDialogHost from "@/components/task/copy-task-dialog-host";

// layout for the main app
export const Route = createFileRoute("/_layout")({
  component: RouteComponent,
});

function RouteComponent() {
  const [searchOpen, setSearchOpen] = useState(false);
  return (
    <>
      <Outlet />
      <CommandPalette />
      <CopyTaskDialogHost />
      <SearchCommandMenu open={searchOpen} setOpen={setSearchOpen} />
    </>
  );
}
