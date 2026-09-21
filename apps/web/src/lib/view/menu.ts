// Which actions a view's "⋯" menu offers (B4 §6.7). Built-in views can only
// be linked to; a lock blocks editing and deleting until someone unlocks.

export type ViewMenuItem =
  | "edit"
  | "duplicate"
  | "copyLink"
  | "lock"
  | "unlock"
  | "delete";

export type ViewMenuEntry = {
  item: ViewMenuItem;
  disabled: boolean;
  /** Why the item is disabled, as an i18n key. */
  reasonKey?: string;
};

export function viewMenuItems({
  canEdit,
  canDelete,
  canCreate,
  isLocked,
  isBuiltIn = false,
}: {
  canEdit: boolean;
  canDelete: boolean;
  canCreate: boolean;
  isLocked: boolean;
  isBuiltIn?: boolean;
}): ViewMenuEntry[] {
  if (isBuiltIn) return [{ item: "copyLink", disabled: false }];
  const entries: ViewMenuEntry[] = [];
  if (canEdit) {
    entries.push({
      item: "edit",
      disabled: isLocked,
      ...(isLocked ? { reasonKey: "views:actions.saveDisabledLocked" } : {}),
    });
  }
  if (canCreate) entries.push({ item: "duplicate", disabled: false });
  entries.push({ item: "copyLink", disabled: false });
  if (canEdit) {
    entries.push({ item: isLocked ? "unlock" : "lock", disabled: false });
  }
  if (canDelete) {
    entries.push({
      item: "delete",
      disabled: isLocked,
      ...(isLocked ? { reasonKey: "views:delete.lockedHint" } : {}),
    });
  }
  return entries;
}
