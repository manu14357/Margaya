export type AuditEntryId =
  | "apiKey"
  | "integration"
  | "webhook"
  | "role"
  | "publicBoard"
  | "purge"
  | "import";

export type AuditState = {
  /** Newest first. */
  entries: AuditEntryId[];
  /** The entry that just arrived, highlighted for a moment. */
  fresh: AuditEntryId | null;
};

export type AuditAction =
  | { type: "arrive"; id: AuditEntryId }
  | { type: "settle" };

export const initialAuditState: AuditState = {
  entries: ["role", "publicBoard", "purge", "import"],
  fresh: null,
};

export function auditReducer(
  state: AuditState,
  action: AuditAction,
): AuditState {
  switch (action.type) {
    case "arrive":
      return {
        entries: [
          action.id,
          ...state.entries.filter((entry) => entry !== action.id),
        ],
        fresh: action.id,
      };
    case "settle":
      return { ...state, fresh: null };
  }
}
