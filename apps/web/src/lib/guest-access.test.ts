import { describe, expect, it } from "vitest";
import { guestMayOpen, isGuestRole } from "./guest-access";

const base = "/dashboard/workspace/w1";

describe("guestMayOpen", () => {
  it("opens the screens that hold only the guest's projects", () => {
    for (const path of [
      `${base}/projects`,
      `${base}/project/p1/board`,
      `${base}/task/WEB-1`,
      `${base}/inbox`,
      `${base}/my-work`,
      `${base}/search`,
    ]) {
      expect(guestMayOpen(path), path).toBe(true);
    }
  });

  it("refuses Home and everything about the whole workspace", () => {
    for (const path of [
      base,
      `${base}/`,
      `${base}/members`,
      `${base}/analytics`,
      `${base}/views`,
      `${base}/views/v1`,
      `${base}/stickies`,
      `${base}/drafts`,
      `${base}/archives`,
      `${base}/agents`,
      `${base}/ai`,
      `${base}/profile/u1`,
      `${base}/projects-archive`,
    ]) {
      expect(guestMayOpen(path), path).toBe(false);
    }
  });
});

describe("isGuestRole", () => {
  it("is re-exported from the permissions package", () => {
    expect(isGuestRole("guest")).toBe(true);
    expect(isGuestRole("viewer")).toBe(false);
  });
});
