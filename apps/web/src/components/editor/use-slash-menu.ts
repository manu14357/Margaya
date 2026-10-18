import type { Editor } from "@tiptap/core";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditorRange } from "./use-editor-asset-upload";

export type SlashCommandGroup = "text" | "lists" | "insert";

export type SlashCommand = {
  id: string;
  label: string;
  group: SlashCommandGroup;
  shortcut?: string;
  /** Shown in a 20px cell before the label (the page editor's menu). */
  icon?: LucideIcon;
  search: string;
  run: (editor: Editor, range: EditorRange) => void;
};

export type SlashMenuState = {
  from: number;
  to: number;
  query: string;
  top: number;
  left: number;
  selectedIndex: number;
};

type Options = {
  editor: Editor | null;
  commands: SlashCommand[];
  /** Read at call time: the menu stays closed while it is false. */
  canEdit: () => boolean;
  /** Where the menu goes, relative to the editor shell. */
  positionAt: (editor: Editor, pos: number) => { top: number; left: number };
};

export function filterSlashCommands(
  commands: readonly SlashCommand[],
  query: string,
): SlashCommand[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...commands];
  return commands.filter(
    (command) =>
      command.label.toLowerCase().includes(needle) ||
      command.search.includes(needle),
  );
}

/**
 * The "/" command menu: opens after a slash at a word start, filters as the
 * user types, and takes Arrow keys, Enter, Tab and Escape while it is open.
 */
export function useSlashMenu({
  editor,
  commands,
  canEdit,
  positionAt,
}: Options) {
  const [menu, setMenu] = useState<SlashMenuState | null>(null);
  const menuRef = useRef<SlashMenuState | null>(null);
  menuRef.current = menu;
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;
  const positionAtRef = useRef(positionAt);
  positionAtRef.current = positionAt;

  const filtered = useMemo(
    () => filterSlashCommands(commands, menu?.query ?? ""),
    [commands, menu?.query],
  );
  const filteredRef = useRef(filtered);
  filteredRef.current = filtered;

  const close = useCallback(() => setMenu(null), []);

  const run = useCallback(
    (command: SlashCommand) => {
      const current = menuRef.current;
      if (!canEditRef.current() || !editor || !current) return;
      command.run(editor, { from: current.from, to: current.to });
      setMenu(null);
    },
    [editor],
  );

  const select = useCallback((index: number) => {
    setMenu((current) =>
      current ? { ...current, selectedIndex: index } : current,
    );
  }, []);

  useEffect(() => {
    if (!editor) return;
    const sync = () => {
      if (editor.isDestroyed) return;
      const { state } = editor;
      if (!canEditRef.current() || !state.selection.empty) {
        setMenu(null);
        return;
      }
      const { $from } = state.selection;
      if ($from.parent.type.name === "codeBlock") {
        setMenu(null);
        return;
      }
      const textBefore = state.doc.textBetween(
        $from.start(),
        $from.pos,
        "\n",
        "\0",
      );
      const match = /(?:^|\s)\/([^\s/]*)$/.exec(textBefore);
      if (!match) {
        setMenu(null);
        return;
      }
      const query = match[1] || "";
      const from = $from.pos - query.length - 1;
      const to = $from.pos;
      const coords = positionAtRef.current(editor, $from.pos);
      setMenu((current) => ({
        from,
        to,
        query,
        top: coords.top - 2,
        left: coords.left,
        selectedIndex:
          current?.from === from && current.query === query
            ? current.selectedIndex
            : 0,
      }));
    };
    editor.on("selectionUpdate", sync);
    editor.on("update", sync);
    return () => {
      editor.off("selectionUpdate", sync);
      editor.off("update", sync);
    };
  }, [editor]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const current = menuRef.current;
      if (!editor || !current || !editor.isFocused) return;
      const list = filteredRef.current;
      if (event.key === "Escape") {
        event.preventDefault();
        setMenu(null);
        return;
      }
      if (list.length === 0) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        select((current.selectedIndex + step + list.length) % list.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const command = list[current.selectedIndex] ?? list[0];
        if (command) run(command);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [editor, run, select]);

  // Keep the highlighted item inside the filtered list.
  useEffect(() => {
    if (!menu || filtered.length === 0) return;
    if (menu.selectedIndex >= filtered.length) select(0);
  }, [filtered, menu, select]);

  return { menu, filtered, run, select, close };
}
