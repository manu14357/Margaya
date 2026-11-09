import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useState } from "react";
import { AskHotkey } from "@/components/ai/ask/ask-hotkey";
import AskPanel from "@/components/ai/ask/lazy-ask-panel";
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
      <AskPanel />
      <AskHotkey />
      <CopyTaskDialogHost />
      <SearchCommandMenu open={searchOpen} setOpen={setSearchOpen} />
    </>
  );
}
