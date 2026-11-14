// Whiteboard domain rules. Pure functions: controllers load rows, these
// decide. Boards have no private access level: whoever may read the
// project's whiteboards sees every board in it.

export const WHITEBOARD_MESSAGES = {
  notFound: "Whiteboard not found",
  notInTrash: "Whiteboard not found in the trash",
  locked: "This whiteboard is locked. Unlock it to make changes.",
  archived: "This whiteboard is archived. Restore it to make changes.",
  noFields: "Provide at least one field to change",
  invalidIcon: "Choose a single emoji",
  ownerOrManager: "Only the whiteboard's creator or an admin can do this",
  managerOnly: "Only an admin can do this",
  deleteNotArchived: "Archive the whiteboard before deleting it",
  tooLarge: "This whiteboard is too large",
  tooManyElements: "This whiteboard has reached its element limit",
  publicDisabled: "Public pages are turned off for this workspace",
  publishArchived: "Restore the whiteboard before publishing it",
  assetNotFound: "Image not found",
  projectLimit: "This project has reached the limit of 5,000 whiteboards",
} as const;

export const WHITEBOARD_LIMITS = {
  titleLength: 255,
  boardsPerProject: 5000,
  /** Elements one REST request may add or replace. */
  elementsPerRequest: 2000,
  /** Boards the workspace-wide list returns, newest updated first. */
  workspaceListSize: 2000,
  /** The JSON body of a request carrying elements. */
  requestBodyBytes: 4 * 1024 * 1024,
} as const;

/** The caller's whiteboard permissions, read once per request. */
export type WhiteboardCaller = {
  userId: string;
  /** whiteboard:read */
  canRead: boolean;
  /** whiteboard:create */
  canCreate: boolean;
  /** whiteboard:update */
  canUpdate: boolean;
  /** whiteboard:delete: manages (locks, archives, trashes, publishes) any board. */
  isManager: boolean;
};

export type WhiteboardState = {
  createdById: string | null;
  isLocked: boolean;
  archivedAt: Date | null;
  deletedAt?: Date | null;
};

export type WhiteboardCapabilities = {
  /** Edit the content, title and icon. */
  canEdit: boolean;
  /** Lock, archive and move to the trash (the creator, or a manager). */
  canManage: boolean;
  /** Publish or unpublish a public link (managers only). */
  canPublish: boolean;
  /** Make a copy in the same project. */
  canDuplicate: boolean;
};

export function isCreator(
  board: Pick<WhiteboardState, "createdById">,
  caller: Pick<WhiteboardCaller, "userId">,
): boolean {
  return board.createdById !== null && board.createdById === caller.userId;
}

/** Not locked, archived or trashed. */
export function isEditableState(
  board: Pick<WhiteboardState, "isLocked" | "archivedAt" | "deletedAt">,
): boolean {
  return !board.isLocked && board.archivedAt === null && !board.deletedAt;
}

/** The 409 message for a board that can't change; archived is checked first. */
export function editableStateError(
  board: Pick<WhiteboardState, "isLocked" | "archivedAt">,
): string | null {
  if (board.archivedAt !== null) return WHITEBOARD_MESSAGES.archived;
  if (board.isLocked) return WHITEBOARD_MESSAGES.locked;
  return null;
}

/** whiteboard:update on a board that is not locked, archived or trashed. */
export function canEditBoard(
  board: Pick<WhiteboardState, "isLocked" | "archivedAt" | "deletedAt">,
  caller: WhiteboardCaller,
): boolean {
  return caller.canRead && caller.canUpdate && isEditableState(board);
}

/** Lock, archive and trash: the creator with whiteboard:update, or a manager. */
export function canManageBoard(
  board: Pick<WhiteboardState, "createdById">,
  caller: WhiteboardCaller,
): boolean {
  if (!caller.canRead) return false;
  return caller.isManager || (caller.canUpdate && isCreator(board, caller));
}

export function whiteboardCapabilities(
  board: WhiteboardState,
  caller: WhiteboardCaller,
): WhiteboardCapabilities {
  return {
    canEdit: canEditBoard(board, caller),
    canManage: canManageBoard(board, caller),
    canPublish: caller.canRead && caller.isManager && board.archivedAt === null,
    canDuplicate: caller.canRead && caller.canCreate,
  };
}

export { isSingleEmoji } from "../page/rules";
