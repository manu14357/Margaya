"use client";

import { PanelLeft, X } from "lucide-react";
import { useEffect, useState } from "react";

/** Shows the docs sidebar on small screens, where it is hidden by default. */
export function DocsSidebarToggle({ controls }: { controls: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const sidebar = document.getElementById(controls);
    if (sidebar) sidebar.dataset.open = String(open);
  }, [open, controls]);

  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      onClick={() => setOpen((value) => !value)}
      className="flex h-9 shrink-0 items-center gap-2 rounded-md border px-3 text-sm lg:hidden"
    >
      {open ? (
        <X aria-hidden="true" className="size-4" />
      ) : (
        <PanelLeft aria-hidden="true" className="size-4" />
      )}
      <span>Pages</span>
    </button>
  );
}
