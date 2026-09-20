import { describe, expect, it } from "vitest";
import {
  type IntakeActionContext,
  intakeDetailActions,
} from "./intake-actions";

const triager: Omit<IntakeActionContext, "status"> = {
  canTriage: true,
  canUpdateTasks: true,
  canDeleteTasks: false,
  isSubmitter: false,
};

const requester: Omit<IntakeActionContext, "status"> = {
  canTriage: false,
  canUpdateTasks: false,
  canDeleteTasks: false,
  isSubmitter: true,
};

const viewer: Omit<IntakeActionContext, "status"> = {
  ...requester,
  isSubmitter: false,
};

describe("intakeDetailActions", () => {
  it("gives triagers accept, decline and snooze on pending requests", () => {
    expect(intakeDetailActions({ ...triager, status: "pending" })).toEqual({
      buttons: ["accept", "decline", "snooze"],
      menu: ["duplicate", "copyLink", "openTaskPage"],
    });
  });

  it("offers delete only with task:delete", () => {
    expect(
      intakeDetailActions({
        ...triager,
        canDeleteTasks: true,
        status: "pending",
      }).menu,
    ).toEqual(["duplicate", "copyLink", "openTaskPage", "delete"]);
  });

  it("swaps snooze for unsnooze and a date change on snoozed requests", () => {
    expect(intakeDetailActions({ ...triager, status: "snoozed" })).toEqual({
      buttons: ["accept", "decline", "unsnooze"],
      menu: ["snoozeAgain", "duplicate", "copyLink", "openTaskPage"],
    });
  });

  it("lets triagers reopen declined and duplicate requests", () => {
    for (const status of ["declined", "duplicate"] as const) {
      expect(intakeDetailActions({ ...triager, status })).toEqual({
        buttons: ["reopen"],
        menu: ["copyLink", "openTaskPage"],
      });
    }
  });

  it("points everyone at the task once accepted", () => {
    for (const context of [triager, requester, viewer]) {
      expect(intakeDetailActions({ ...context, status: "accepted" })).toEqual({
        buttons: ["openTask"],
        menu: ["copyLink"],
      });
    }
  });

  it("lets requesters edit and withdraw their open request", () => {
    expect(intakeDetailActions({ ...requester, status: "pending" })).toEqual({
      buttons: ["edit"],
      menu: ["withdraw", "copyLink"],
    });
    expect(intakeDetailActions({ ...requester, status: "declined" })).toEqual({
      buttons: [],
      menu: ["copyLink"],
    });
  });

  it("uses the regular edit and delete paths for requesters who have them", () => {
    expect(
      intakeDetailActions({
        ...requester,
        canUpdateTasks: true,
        canDeleteTasks: true,
        status: "pending",
      }),
    ).toEqual({ buttons: [], menu: ["delete", "copyLink"] });
  });

  it("lets a triager withdraw their own request without task:delete", () => {
    expect(
      intakeDetailActions({ ...triager, isSubmitter: true, status: "pending" })
        .menu,
    ).toContain("withdraw");
  });

  it("gives other viewers only the link", () => {
    for (const status of ["pending", "snoozed", "declined"] as const) {
      expect(intakeDetailActions({ ...viewer, status })).toEqual({
        buttons: [],
        menu: ["copyLink"],
      });
    }
  });
});
