import { describe, expect, it } from "vitest";
import { finalStateOf } from "../../demo";
import { initialTrashState, trashReducer } from "./state";
import { createTrashScene } from "./trash-scene";

describe("trash scene", () => {
  it("ends on the board with the restored task out of the trash", () => {
    expect(finalStateOf(createTrashScene())).toEqual({
      view: "board",
      trashed: ["banner", "legacy"],
      restored: ["pricing"],
      toast: false,
    });
  });

  it("shows the toast after a restore and ignores a second restore", () => {
    const once = trashReducer(initialTrashState, {
      type: "restore",
      id: "pricing",
    });
    expect(once.toast).toBe(true);
    expect(trashReducer(once, { type: "restore", id: "pricing" })).toBe(once);
  });

  it("goes back to the trash from the board", () => {
    const board = trashReducer(initialTrashState, { type: "openBoard" });
    expect(trashReducer(board, { type: "openTrash" }).view).toBe("trash");
  });
});
