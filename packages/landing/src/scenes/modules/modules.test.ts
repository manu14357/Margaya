import { describe, expect, it } from "vitest";
import messages from "../../../../../i18n/en-US.json";
import { finalStateOf } from "../../demo";
import { createModulesScene, RESTATUSED_MODULE_ID } from "./modules-scene";
import { moduleProgress, modulesReducer } from "./state";

const scene = createModulesScene(messages.landing.demo);

describe("modules scene", () => {
  it("computes progress from completed work", () => {
    expect(
      moduleProgress({ completed: 10, started: 3, unstarted: 2, backlog: 1 }),
    ).toBe(63);
    expect(
      moduleProgress({ completed: 0, started: 0, unstarted: 0, backlog: 0 }),
    ).toBe(0);
  });

  it("closes the status popover when the layout changes", () => {
    const open = modulesReducer(scene.initialState, {
      type: "openStatus",
      id: "api",
    });
    expect(open.menuFor).toBe("api");
    const switched = modulesReducer(open, {
      type: "layout",
      layout: "gallery",
    });
    expect(switched).toMatchObject({ layout: "gallery", menuFor: null });
  });

  it("ends in the gallery with the module in progress", () => {
    const final = finalStateOf(scene);
    expect(final.layout).toBe("gallery");
    expect(final.menuFor).toBeNull();
    const module = final.modules.find(
      (candidate) => candidate.id === RESTATUSED_MODULE_ID,
    );
    expect(module?.status).toBe("in-progress");
    expect(final.modules.every((candidate) => candidate.name)).toBe(true);
  });
});
