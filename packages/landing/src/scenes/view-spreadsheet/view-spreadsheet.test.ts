import { describe, expect, it } from "vitest";
import messages from "../../../../../i18n/en-US.json";
import { finalStateOf } from "../../demo";
import { viewTasks } from "../views-shared/data";
import { spreadsheetViewReducer } from "./state";
import { createSpreadsheetViewScene } from "./view-spreadsheet-scene";

const demo = messages.landing.demo;
const initial = {
  tasks: viewTasks(demo),
  editing: null,
  edited: null,
  selected: [],
};

describe("spreadsheet view scene", () => {
  it("opens one picker at a time and closes it on a second click", () => {
    const open = spreadsheetViewReducer(initial, { type: "open", id: "a11y" });
    expect(open.editing).toBe("a11y");
    expect(
      spreadsheetViewReducer(open, { type: "open", id: "a11y" }).editing,
    ).toBeNull();
  });

  it("sets the picked priority and closes the picker", () => {
    const open = spreadsheetViewReducer(initial, { type: "open", id: "a11y" });
    const picked = spreadsheetViewReducer(open, {
      type: "pick",
      id: "a11y",
      priority: "low",
    });
    expect(picked.editing).toBeNull();
    expect(picked.edited).toBe("a11y");
    expect(picked.tasks.find((task) => task.id === "a11y")?.priority).toBe(
      "low",
    );
  });

  it("ends with the latency task urgent", () => {
    const final = finalStateOf(createSpreadsheetViewScene(demo));
    expect(final.editing).toBeNull();
    expect(final.tasks.find((task) => task.id === "latency")?.priority).toBe(
      "urgent",
    );
  });
});
