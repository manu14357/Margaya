// Reads the board controller (selection, write access) while rendering.
"use no memo";

import { Group, Lightbulb, ScrollText, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@/components/ui/menu";
import { ToolbarButton } from "@/components/ui/toolbar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { groupableNotes } from "./board-ai";
import type { BoardAiMode } from "./board-ai-dialog";
import { BUTTON_CLASS } from "./toolbar";
import { useController, useEditorState } from "./use-editor";

/**
 * The toolbar's AI menu. Only rendered where AI is available for the board's
 * project; the API checks every switch and permission again.
 */
export function BoardAiMenu({
  compact,
  onOpen,
}: {
  compact: boolean;
  onOpen: (mode: BoardAiMode) => void;
}) {
  const { t } = useTranslation();
  const c = useController();
  useEditorState((state) => state.selectedIds);
  useEditorState((state) => state.sceneVersion);
  const writable = !c.readOnly;
  const groupable =
    writable && groupableNotes(c.selectedElements()).length >= 2;
  const hasSelection = c.state.selectedIds.length > 0;
  const label = t("whiteboardEditor:ai.menu");
  const side = compact ? "top" : "bottom";
  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <ToolbarButton
                  aria-label={label}
                  className={cn(BUTTON_CLASS, "data-popup-open:bg-accent")}
                  data-testid="whiteboard-ai-menu"
                />
              }
            />
          }
        >
          <Sparkles className="size-4" aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent side={side}>{label}</TooltipContent>
      </Tooltip>
      <MenuPopup side={side} align="end">
        {writable && (
          <MenuItem onClick={() => onOpen("brainstorm")}>
            <Lightbulb aria-hidden="true" />
            {t("whiteboardEditor:ai.brainstorm")}
          </MenuItem>
        )}
        {groupable && (
          <MenuItem onClick={() => onOpen("group")}>
            <Group aria-hidden="true" />
            {t("whiteboardEditor:ai.group")}
          </MenuItem>
        )}
        <MenuItem onClick={() => onOpen("summarize")}>
          <ScrollText aria-hidden="true" />
          {hasSelection
            ? t("whiteboardEditor:ai.summarizeSelection")
            : t("whiteboardEditor:ai.summarizeBoard")}
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}
