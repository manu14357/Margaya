import type {
  WhiteboardCapabilities,
  WhiteboardSummary,
} from "@/types/whiteboard";

type WorkspaceRights = {
  userId: string | undefined;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
};

/**
 * What the caller may do with a board in a list, where rows carry no
 * capabilities: the API's rules applied to the workspace capabilities. The
 * board screen uses the API's own answer, and the API enforces it anyway.
 */
export function summaryCapabilities(
  board: Pick<WhiteboardSummary, "isLocked" | "archivedAt" | "createdBy">,
  { userId, canCreate, canUpdate, canDelete }: WorkspaceRights,
): WhiteboardCapabilities {
  const isOwn = Boolean(userId) && board.createdBy?.id === userId;
  const archived = Boolean(board.archivedAt);
  return {
    canEdit: canUpdate && !board.isLocked && !archived,
    canManage: canDelete || (canUpdate && isOwn),
    canPublish: canDelete && !archived,
    canDuplicate: canCreate,
  };
}

export type WhiteboardMenuItemId =
  | "open"
  | "openInNewTab"
  | "copyLink"
  | "rename"
  | "icon"
  | "duplicate"
  | "share"
  | "lock"
  | "archive"
  | "delete";

/** A board's menu items, gated by what the caller may do with it. */
export function whiteboardMenuItemIds(
  board: Pick<WhiteboardSummary, "archivedAt">,
  capabilities: WhiteboardCapabilities,
  { withOpen = false }: { withOpen?: boolean } = {},
): WhiteboardMenuItemId[] {
  const archived = Boolean(board.archivedAt);
  const ids: WhiteboardMenuItemId[] = withOpen
    ? ["open", "openInNewTab", "copyLink"]
    : ["copyLink"];
  if (capabilities.canEdit) ids.push("rename", "icon");
  if (capabilities.canDuplicate) ids.push("duplicate");
  if (capabilities.canPublish) ids.push("share");
  if (capabilities.canManage && !archived) ids.push("lock");
  if (capabilities.canManage) ids.push("archive");
  if (capabilities.canManage && archived) ids.push("delete");
  return ids;
}
