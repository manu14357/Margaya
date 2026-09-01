import { describe, expect, it } from "vitest";
import messages from "../../../../../i18n/en-US.json";
import { finalStateOf } from "../../demo";
import { createHomeScene } from "./home-scene";
import { homeReducer, NEW_STICKY_ID } from "./state";

const demo = messages.landing.demo;
const scene = createHomeScene(demo);

describe("home scene", () => {
  it("adds one empty sticky first and focuses it", () => {
    const added = homeReducer(scene.initialState, { type: "addSticky" });
    expect(added.stickies[0]).toEqual({
      id: NEW_STICKY_ID,
      color: "yellow",
      text: "",
    });
    expect(added.editing).toBe(NEW_STICKY_ID);
    const again = homeReducer(added, { type: "addSticky" });
    expect(again.stickies).toHaveLength(added.stickies.length);
  });

  it("shows saving while typing and clears it on blur", () => {
    const typing = homeReducer(
      homeReducer(scene.initialState, { type: "addSticky" }),
      { type: "input", id: NEW_STICKY_ID, value: "Hi" },
    );
    expect(typing.saving).toBe(true);
    expect(homeReducer(typing, { type: "blur" })).toMatchObject({
      saving: false,
      editing: null,
    });
  });

  it("ends scrolled to stickies with the note typed", () => {
    const final = finalStateOf(scene);
    expect(final.reveal).toBe("stickies");
    expect(final.stickies[0]).toMatchObject({
      id: NEW_STICKY_ID,
      text: demo.home.typed,
    });
    expect(final.stickies).toHaveLength(3);
    expect(final.saving).toBe(false);
  });
});
