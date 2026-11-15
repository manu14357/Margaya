import {
  Archive,
  ArchiveRestore,
  Copy,
  ExternalLink,
  Globe,
  Link2,
  Lock,
  LockOpen,
  Pencil,
  PenTool,
  SmilePlus,
  Trash2,
} from "lucide-react";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/menu";
import {
  type WhiteboardMenuItemId,
  whiteboardMenuItemIds,
} from "@/lib/whiteboards/whiteboard-capabilities";
import type {
  WhiteboardCapabilities,
  WhiteboardSummary,
} from "@/types/whiteboard";
import type { WhiteboardActions } from "./use-whiteboard-actions";

type WhiteboardMenuItemsProps = {
  board: WhiteboardSummary;
  capabilities: WhiteboardCapabilities;
  actions: WhiteboardActions;
  withOpen?: boolean;
};

// Items after which a separator starts a new group.
const GROUP_ENDS = new Set<WhiteboardMenuItemId>(["copyLink", "duplicate"]);

/** A board's dropdown menu entries, gated by its capabilities. */
export default function WhiteboardMenuItems({
  board,
  capabilities,
  actions,
  withOpen,
}: WhiteboardMenuItemsProps) {
  const { t } = useTranslation();
  const ids = whiteboardMenuItemIds(board, capabilities, { withOpen });

  const item = (id: WhiteboardMenuItemId) => {
    switch (id) {
      case "open":
        return (
          <DropdownMenuItem onClick={actions.open}>
            <PenTool />
            {t("whiteboards:actions.open")}
          </DropdownMenuItem>
        );
      case "openInNewTab":
        return (
          <DropdownMenuItem onClick={actions.openInNewTab}>
            <ExternalLink />
            {t("whiteboards:actions.openInNewTab")}
          </DropdownMenuItem>
        );
      case "copyLink":
        return (
          <DropdownMenuItem onClick={() => void actions.copyLink()}>
            <Link2 />
            {t("whiteboards:actions.copyLink")}
          </DropdownMenuItem>
        );
      case "rename":
        return (
          <DropdownMenuItem onClick={actions.openRename}>
            <Pencil />
            {t("whiteboards:actions.rename")}
          </DropdownMenuItem>
        );
      case "icon":
        return (
          <DropdownMenuItem onClick={actions.openIcon}>
            <SmilePlus />
            {t("whiteboards:actions.changeIcon")}
          </DropdownMenuItem>
        );
      case "duplicate":
        return (
          <DropdownMenuItem
            onClick={actions.duplicate}
            disabled={actions.isDuplicating}
          >
            <Copy />
            {t("whiteboards:actions.duplicate")}
          </DropdownMenuItem>
        );
      case "share":
        return (
          <DropdownMenuItem onClick={actions.openShare}>
            <Globe />
            {board.publicToken
              ? t("whiteboards:actions.managePublicLink")
              : t("whiteboards:actions.publish")}
          </DropdownMenuItem>
        );
      case "lock":
        return (
          <DropdownMenuItem onClick={actions.toggleLock}>
            {board.isLocked ? <LockOpen /> : <Lock />}
            {board.isLocked
              ? t("whiteboards:actions.unlock")
              : t("whiteboards:actions.lock")}
          </DropdownMenuItem>
        );
      case "archive":
        return (
          <DropdownMenuItem onClick={actions.toggleArchive}>
            {board.archivedAt ? <ArchiveRestore /> : <Archive />}
            {board.archivedAt
              ? t("whiteboards:actions.unarchive")
              : t("whiteboards:actions.archive")}
          </DropdownMenuItem>
        );
      case "delete":
        return (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={actions.openDelete}
            >
              <Trash2 />
              {t("whiteboards:actions.moveToTrash")}
            </DropdownMenuItem>
          </>
        );
    }
  };

  return ids.map((id, index) => (
    <Fragment key={id}>
      {item(id)}
      {GROUP_ENDS.has(id) &&
        index < ids.length - 1 &&
        ids[index + 1] !== "delete" && <DropdownMenuSeparator />}
    </Fragment>
  ));
}
