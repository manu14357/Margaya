import type { LabelColor, Priority } from "../../replica";

export type RequestStatus = "pending" | "accepted" | "declined";

export type IntakeRequest = {
  id: string;
  number: number;
  title: string;
  body: string;
  time: string;
  source: string;
  submitter: string;
  priority: Priority;
  label: { name: string; color: LabelColor };
  status: RequestStatus;
  /** The column an accepted request went to. */
  column?: string;
  /** Why a declined request was declined. */
  reason?: string;
};

export type IntakeDialog =
  | { kind: "accept" }
  | { kind: "decline"; reason: string; focused: boolean };

export type IntakeState = {
  requests: IntakeRequest[];
  selectedId: string;
  dialog: IntakeDialog | null;
  /** The key of the request the toast reports as accepted. */
  toast: string | null;
};

export type IntakeAction =
  | { type: "move"; delta: 1 | -1 }
  | { type: "select"; id: string }
  | { type: "openAccept" }
  | { type: "openDecline" }
  | { type: "closeDialog" }
  | { type: "focusReason" }
  | { type: "reason"; value: string }
  | { type: "accept"; column: string }
  | { type: "decline" };

function updateSelected(
  state: IntakeState,
  patch: Partial<IntakeRequest>,
): IntakeRequest[] {
  return state.requests.map((request) =>
    request.id === state.selectedId ? { ...request, ...patch } : request,
  );
}

function selected(state: IntakeState) {
  return state.requests.find((request) => request.id === state.selectedId);
}

export function intakeReducer(
  state: IntakeState,
  action: IntakeAction,
): IntakeState {
  switch (action.type) {
    case "move": {
      // Like J / K in the app: the selection stops at either end.
      if (state.dialog) return state;
      const index = state.requests.findIndex(
        (request) => request.id === state.selectedId,
      );
      const next = state.requests[index + action.delta];
      return next ? { ...state, selectedId: next.id } : state;
    }
    case "select":
      return { ...state, selectedId: action.id, dialog: null };
    case "openAccept":
      return selected(state)?.status === "pending"
        ? { ...state, dialog: { kind: "accept" }, toast: null }
        : state;
    case "openDecline":
      return selected(state)?.status === "pending"
        ? {
            ...state,
            dialog: { kind: "decline", reason: "", focused: false },
            toast: null,
          }
        : state;
    case "closeDialog":
      return { ...state, dialog: null };
    case "focusReason":
      return state.dialog?.kind === "decline"
        ? { ...state, dialog: { ...state.dialog, focused: true } }
        : state;
    case "reason":
      return state.dialog?.kind === "decline"
        ? {
            ...state,
            dialog: { ...state.dialog, reason: action.value, focused: true },
          }
        : state;
    case "accept": {
      const request = selected(state);
      if (state.dialog?.kind !== "accept" || !request) return state;
      return {
        ...state,
        dialog: null,
        toast: request.id,
        requests: updateSelected(state, {
          status: "accepted",
          column: action.column,
        }),
      };
    }
    case "decline": {
      if (state.dialog?.kind !== "decline") return state;
      const reason = state.dialog.reason.trim();
      return {
        ...state,
        dialog: null,
        requests: updateSelected(state, {
          status: "declined",
          reason: reason || undefined,
        }),
      };
    }
  }
}
