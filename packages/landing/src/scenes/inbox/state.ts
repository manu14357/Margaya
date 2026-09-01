export type InboxItem = {
  id: string;
  /** Who did it; null for reminders the system sends. */
  actor: string | null;
  verb: string;
  taskKey: string;
  task: string;
  preview?: string;
  time: string;
  unread: boolean;
  snoozed: boolean;
};

export type InboxState = {
  items: InboxItem[];
  /** The row showing its hover actions. */
  hover: string | null;
  /** The row whose snooze menu is open. */
  menuFor: string | null;
  /** The snooze toast is showing. */
  toast: boolean;
};

export type InboxAction =
  | { type: "hover"; id: string | null }
  | { type: "openSnooze"; id: string }
  | { type: "closeSnooze" }
  | { type: "snooze"; id: string }
  | { type: "read"; id: string }
  | { type: "markAllRead" };

/** The rows the inbox lists: snoozed ones wait in the Snoozed view. */
export function visibleItems(state: InboxState): InboxItem[] {
  return state.items.filter((item) => !item.snoozed);
}

export function unreadCount(state: InboxState): number {
  return visibleItems(state).filter((item) => item.unread).length;
}

export function inboxReducer(
  state: InboxState,
  action: InboxAction,
): InboxState {
  switch (action.type) {
    case "hover":
      return { ...state, hover: action.id };
    case "openSnooze":
      return {
        ...state,
        hover: action.id,
        menuFor: state.menuFor === action.id ? null : action.id,
      };
    case "closeSnooze":
      return { ...state, menuFor: null };
    case "snooze":
      return {
        ...state,
        menuFor: null,
        hover: null,
        toast: true,
        items: state.items.map((item) =>
          item.id === action.id ? { ...item, snoozed: true } : item,
        ),
      };
    case "read":
      return {
        ...state,
        items: state.items.map((item) =>
          item.id === action.id ? { ...item, unread: !item.unread } : item,
        ),
      };
    case "markAllRead":
      return {
        ...state,
        items: state.items.map((item) => ({ ...item, unread: false })),
      };
  }
}
