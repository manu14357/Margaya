import { describe, expect, it } from "vitest";
import { viewMenuItems } from "./menu";

const items = (options: Parameters<typeof viewMenuItems>[0]) =>
  viewMenuItems(options).map((entry) => entry.item);

describe("view menu", () => {
  it("offers everything to an owner or admin", () => {
    expect(
      items({
        canEdit: true,
        canDelete: true,
        canCreate: true,
        isLocked: false,
      }),
    ).toEqual(["edit", "duplicate", "copyLink", "lock", "delete"]);
  });

  it("only links and duplicates for other members", () => {
    expect(
      items({
        canEdit: false,
        canDelete: false,
        canCreate: true,
        isLocked: false,
      }),
    ).toEqual(["duplicate", "copyLink"]);
    expect(
      items({
        canEdit: false,
        canDelete: false,
        canCreate: false,
        isLocked: false,
      }),
    ).toEqual(["copyLink"]);
  });

  it("offers unlock on a locked view and disables edit and delete", () => {
    const entries = viewMenuItems({
      canEdit: true,
      canDelete: true,
      canCreate: true,
      isLocked: true,
    });
    expect(entries.map((entry) => entry.item)).toEqual([
      "edit",
      "duplicate",
      "copyLink",
      "unlock",
      "delete",
    ]);
    expect(entries.find((entry) => entry.item === "edit")?.disabled).toBe(true);
    expect(entries.find((entry) => entry.item === "delete")).toMatchObject({
      disabled: true,
      reasonKey: "views:delete.lockedHint",
    });
  });

  it("only links to built-in views", () => {
    expect(
      items({
        canEdit: true,
        canDelete: true,
        canCreate: true,
        isLocked: false,
        isBuiltIn: true,
      }),
    ).toEqual(["copyLink"]);
  });
});
