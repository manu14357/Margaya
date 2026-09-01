import { describe, expect, it } from "vitest";
import messages from "../../../../../i18n/en-US.json";
import { finalStateOf } from "../../demo";
import {
  ACCEPTED_REQUEST_ID,
  createIntakeScene,
  DECLINED_REQUEST_ID,
} from "./intake-scene";
import { intakeReducer } from "./state";

const demo = messages.landing.demo;
const scene = createIntakeScene(demo);

describe("intake scene", () => {
  it("moves with J and K and stops at the ends", () => {
    const up = intakeReducer(scene.initialState, { type: "move", delta: -1 });
    expect(up.selectedId).toBe(scene.initialState.selectedId);
    const down = intakeReducer(scene.initialState, { type: "move", delta: 1 });
    expect(down.selectedId).toBe("invoices");
  });

  it("accepts only through the open dialog", () => {
    const ignored = intakeReducer(scene.initialState, {
      type: "accept",
      column: "To do",
    });
    expect(ignored).toBe(scene.initialState);
    const opened = intakeReducer(scene.initialState, { type: "openAccept" });
    const accepted = intakeReducer(opened, { type: "accept", column: "To do" });
    expect(accepted.dialog).toBeNull();
    expect(accepted.requests[0]).toMatchObject({
      status: "accepted",
      column: "To do",
    });
    // A closed request does not open the dialogs again.
    expect(intakeReducer(accepted, { type: "openDecline" }).dialog).toBeNull();
  });

  it("keeps the keyboard out of an open dialog", () => {
    const opened = intakeReducer(scene.initialState, { type: "openDecline" });
    expect(intakeReducer(opened, { type: "move", delta: 1 })).toBe(opened);
  });

  it("ends with one request accepted and one declined with the reason", () => {
    const final = finalStateOf(scene);
    const byId = (id: string) =>
      final.requests.find((request) => request.id === id);
    expect(byId(ACCEPTED_REQUEST_ID)).toMatchObject({
      status: "accepted",
      column: demo.statuses.todo,
    });
    expect(byId(DECLINED_REQUEST_ID)).toMatchObject({
      status: "declined",
      reason: demo.intake.decline.typed,
    });
    expect(final.selectedId).toBe(DECLINED_REQUEST_ID);
    expect(final.dialog).toBeNull();
    expect(
      final.requests.filter((request) => request.status === "pending"),
    ).toHaveLength(2);
  });
});
