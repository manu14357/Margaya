import { describe, expect, it } from "vitest";
import messages from "../../../../../i18n/en-US.json";
import { finalStateOf } from "../../demo";
import { viewTasks } from "../views-shared/data";
import { listViewReducer } from "./state";
import { createListViewScene } from "./view-list-scene";

const demo = messages.landing.demo;
const initial = { tasks: viewTasks(demo), collapsed: [], selected: [] };

describe("list view scene", () => {
  it("folds and unfolds a status group", () => {
    const folded = listViewReducer(initial, {
      type: "toggleGroup",
      status: "done",
    });
    expect(folded.collapsed).toEqual(["done"]);
    const unfolded = listViewReducer(folded, {
      type: "toggleGroup",
      status: "done",
    });
    expect(unfolded.collapsed).toEqual([]);
  });

  it("toggles and clears the selection", () => {
    const one = listViewReducer(initial, { type: "toggleSelect", id: "a11y" });
    expect(one.selected).toEqual(["a11y"]);
    expect(
      listViewReducer(one, { type: "toggleSelect", id: "a11y" }).selected,
    ).toEqual([]);
    expect(listViewReducer(one, { type: "clearSelection" }).selected).toEqual(
      [],
    );
  });

  it("ends with every group open and two tasks selected", () => {
    const final = finalStateOf(createListViewScene(demo));
    expect(final.collapsed).toEqual([]);
    expect(final.selected).toEqual(["tokens", "latency"]);
  });
});
