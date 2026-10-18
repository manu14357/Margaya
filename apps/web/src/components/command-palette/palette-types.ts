import type { ReactNode } from "react";

/** A list the palette shows in place of its root, e.g. the languages. */
export type PaletteSubmenu = {
  label: string;
  items: PaletteActionItem[];
};

export type PaletteActionItem = {
  value: string;
  label: string;
  shortcut?: string;
  /** Secondary text on the right, e.g. a task key or a project name. */
  hint?: string;
  icon?: ReactNode;
  /** Runs only once the palette has fully closed (see TaskGroupItem). */
  afterClose?: boolean;
  /** Opens a sub-list instead of running: the palette stays open. */
  submenu?: () => PaletteSubmenu;
  onRun: () => void;
};

export type PaletteGroup = {
  value: string;
  label: string;
  items: PaletteActionItem[];
};
