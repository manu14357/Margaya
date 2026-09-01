import { describe, expect, it } from "vitest";
import messages from "../../../../../i18n/en-US.json";
import { finalStateOf } from "../../demo";
import { viewTasks } from "../views-shared/data";
import { boardViewReducer } from "./state";
import { createBoardViewScene } from "./view-board-scene";

const demo = messages.landing.demo;

describe("board view scene", () => {
  it("moves a card to the top of another column", () => {
    const state = boardViewReducer(
      { tasks: viewTasks(demo) },
      { type: "move", id: "latency", status: "done" },
    );
    const done = state.tasks.filter((task) => task.status === "done");
    expect(done[0]?.id).toBe("latency");
    expect(state.tasks).toHaveLength(viewTasks(demo).length);
  });

  it("ends with the tokens card in review", () => {
    const final = finalStateOf(createBoardViewScene(demo));
    const inReview = final.tasks.filter((task) => task.status === "inReview");
    expect(inReview[0]).toMatchObject({
      id: "tokens",
      title: demo.views.tasks.tokens,
    });
  });
});
