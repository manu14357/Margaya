import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import type {
  SlashCommand,
  SlashCommandGroup,
  SlashMenuState,
} from "./use-slash-menu";

type SlashMenuProps = {
  menu: SlashMenuState;
  filtered: SlashCommand[];
  onRun: (command: SlashCommand) => void;
  onSelect: (index: number) => void;
};

const GROUPS: SlashCommandGroup[] = ["text", "lists", "insert"];

/** The "/" menu, grouped Text · Lists · Insert (the task editor's look). */
export default function SlashMenu({
  menu,
  filtered,
  onRun,
  onSelect,
}: SlashMenuProps) {
  const { t } = useTranslation();
  const groupTitles: Record<SlashCommandGroup, string> = {
    text: t("tasks:detail.editor.slash.groups.text"),
    lists: t("tasks:detail.editor.slash.groups.lists"),
    insert: t("tasks:detail.editor.slash.groups.insert"),
  };

  return (
    <div
      className="margaya-tiptap-slash-menu"
      style={{ top: menu.top, left: menu.left, position: "absolute" }}
    >
      {filtered.length > 0 ? (
        GROUPS.map((group) => {
          const items = filtered.filter((command) => command.group === group);
          if (items.length === 0) return null;
          return (
            <div key={group} className="margaya-tiptap-slash-group">
              <div className="margaya-tiptap-slash-group-title">
                {groupTitles[group]}
              </div>
              {items.map((command) => {
                const index = filtered.indexOf(command);
                return (
                  <button
                    key={command.id}
                    type="button"
                    className={cn(
                      "margaya-tiptap-slash-item",
                      menu.selectedIndex === index && "is-selected",
                    )}
                    onMouseEnter={() => onSelect(index)}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      onRun(command);
                    }}
                  >
                    <span className="margaya-tiptap-slash-label">
                      {command.label}
                    </span>
                    {command.shortcut && (
                      <span className="margaya-tiptap-slash-shortcut">
                        {command.shortcut}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })
      ) : (
        <div className="margaya-tiptap-slash-empty">
          {t("tasks:detail.editor.slash.empty")}
        </div>
      )}
    </div>
  );
}
