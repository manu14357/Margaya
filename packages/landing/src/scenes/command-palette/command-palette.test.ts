import { describe, expect, it } from "vitest";
import messages from "../../../../../i18n/en-US.json";
import { finalStateOf, scriptActions } from "../../demo";
import { createPaletteScene } from "./command-palette-scene";
import { paletteGroups, paletteReducer, parseQuery } from "./state";

const demo = messages.landing.demo;
const scene = createPaletteScene(demo);
const groups = {
  thisTask: [
    { id: "status", label: demo.palette.items.status },
    { id: "priority", label: demo.palette.items.priority },
  ],
  suggestions: [{ id: "home", label: demo.palette.items.home }],
  commands: [{ id: "createTask", label: demo.palette.items.createTask }],
};

describe("command palette scene", () => {
  it("reads > as the actions prefix", () => {
    expect(parseQuery("> status")).toEqual({ mode: "actions", term: "status" });
    expect(parseQuery(" home ")).toEqual({ mode: "all", term: "home" });
  });

  it("narrows the typed query to the open task's status command", () => {
    const shown = paletteGroups(demo.palette.typed, groups);
    expect(shown.map((group) => group.id)).toEqual(["thisTask"]);
    expect(shown[0]?.items.map((item) => item.id)).toEqual(["status"]);
  });

  it("shows suggestions only for a plain, empty query", () => {
    expect(paletteGroups("", groups).map((group) => group.id)).toEqual([
      "thisTask",
      "suggestions",
    ]);
    expect(paletteGroups(">", groups).map((group) => group.id)).toEqual([
      "thisTask",
      "commands",
    ]);
  });

  it("opens the picker on the current status and wraps the arrow keys", () => {
    const picker = paletteReducer(scene.initialState, { type: "run" });
    expect(picker.phase).toBe("picker");
    expect(picker.pickerIndex).toBe(1);
    const up = paletteReducer(
      paletteReducer(picker, { type: "move", delta: -1 }),
      { type: "move", delta: -1 },
    );
    expect(up.pickerIndex).toBe(4);
  });

  it("types the copy's query and ends In progress with the toast", () => {
    expect(scriptActions(scene.script)).toContainEqual({
      type: "input",
      value: demo.palette.typed,
    });
    const final = finalStateOf(scene);
    expect(final).toMatchObject({
      phase: "closed",
      status: "inProgress",
      toast: true,
    });
  });
});
