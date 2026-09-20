import type { IntakeStatus } from "@/types/intake";
import { isOpenIntakeStatus } from "./intake";

// Which actions the request detail offers (B7 §4.2 header table). The API
// stays the authority; this only decides what is worth showing.

export type IntakeDetailAction =
  | "accept"
  | "decline"
  | "snooze"
  | "unsnooze"
  | "snoozeAgain"
  | "duplicate"
  | "reopen"
  | "edit"
  | "withdraw"
  | "delete"
  | "copyLink"
  | "openTaskPage"
  | "openTask";

export type IntakeActionContext = {
  /** The effective status. */
  status: IntakeStatus;
  canTriage: boolean;
  canUpdateTasks: boolean;
  canDeleteTasks: boolean;
  isSubmitter: boolean;
};

export type IntakeActionSet = {
  /** Buttons in the header, in order. */
  buttons: IntakeDetailAction[];
  /** Items of the "…" menu, in order. */
  menu: IntakeDetailAction[];
};

/** Delete for task deleters; otherwise a requester withdraws an open request. */
function removal({
  status,
  canDeleteTasks,
  isSubmitter,
}: IntakeActionContext): IntakeDetailAction[] {
  if (canDeleteTasks) return ["delete"];
  if (isSubmitter && isOpenIntakeStatus(status)) return ["withdraw"];
  return [];
}

export function intakeDetailActions(
  context: IntakeActionContext,
): IntakeActionSet {
  const { status, canTriage, canUpdateTasks, isSubmitter } = context;

  if (status === "accepted") {
    return { buttons: ["openTask"], menu: ["copyLink"] };
  }

  if (isOpenIntakeStatus(status)) {
    if (canTriage) {
      const snoozed = status === "snoozed";
      return {
        buttons: ["accept", "decline", snoozed ? "unsnooze" : "snooze"],
        menu: [
          ...(snoozed ? (["snoozeAgain"] as const) : []),
          "duplicate",
          "copyLink",
          "openTaskPage",
          ...removal(context),
        ],
      };
    }
    if (isSubmitter) {
      return {
        buttons: canUpdateTasks ? [] : ["edit"],
        menu: [...removal(context), "copyLink"],
      };
    }
    return { buttons: [], menu: ["copyLink", ...removal(context)] };
  }

  // Declined or duplicate.
  if (canTriage) {
    return {
      buttons: ["reopen"],
      menu: ["copyLink", "openTaskPage", ...removal(context)],
    };
  }
  return { buttons: [], menu: ["copyLink", ...removal(context)] };
}
