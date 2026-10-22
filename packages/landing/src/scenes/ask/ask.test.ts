import { describe, expect, it } from "vitest";
import messages from "../../../../../i18n/en-US.json";
import { finalStateOf } from "../../demo";
import { createAskScene } from "./ask-scene";
import { type AskAction, type AskState, initialAskState } from "./state";

const demo = messages.landing.demo;
const scene = createAskScene(demo);

function run(...actions: AskAction[]): AskState {
  return actions.reduce(scene.reducer, initialAskState);
}

function sent(mode: "ask" | "build", value: string): AskAction[] {
  return [{ type: "mode", mode }, { type: "input", value }, { type: "send" }];
}

const answered: AskAction[] = [
  { type: "read" },
  { type: "tick" },
  { type: "answer" },
];

describe("ask scene", () => {
  it("ends with the blockers answered and the assignment confirmed", () => {
    const final = finalStateOf(scene);
    expect(final.input).toBe("");
    expect(final.mode).toBe("build");
    expect(final.turns.map((turn) => [turn.reply, turn.phase])).toEqual([
      ["blockers", "done"],
      ["assign", "done"],
    ]);
    expect(final.turns[0]?.seconds).toBe(2);
    expect(final.turns[1]?.change).toBe("applied");
    expect(final.assigned).toBe(true);
    expect(final.highlight).toBe(false);
  });

  it("does nothing without a prompt, or while a reply is on its way", () => {
    expect(scene.reducer(initialAskState, { type: "send" })).toBe(
      initialAskState,
    );
    const busy = run(...sent("ask", demo.ask.question));
    expect(scene.reducer(busy, { type: "input", value: "More" }).turns).toBe(
      busy.turns,
    );
    const again = run(
      ...sent("ask", demo.ask.question),
      { type: "input", value: "More" },
      { type: "send" },
    );
    expect(again.turns).toHaveLength(1);
  });

  it("gives any other question an honest canned reply", () => {
    const state = run(...sent("ask", "Who is on call?"), ...answered);
    expect(state.turns[0]?.reply).toBe("generic");
    expect(state.turns[0]?.change).toBeNull();
    const build = run(...sent("build", "Delete everything"), ...answered);
    expect(build.turns[0]?.reply).toBe("generic");
    expect(build.turns[0]?.change).toBeNull();
    expect(scene.reducer(build, { type: "confirm" })).toBe(build);
  });

  it("proposes, confirms and undoes the assignment", () => {
    const ready = run(
      ...sent("build", demo.ask.buildPrompt.toLowerCase()),
      ...answered,
    );
    expect(ready.turns[0]?.change).toBe("ready");
    expect(ready.assigned).toBe(false);
    const applied = scene.reducer(ready, { type: "confirm" });
    expect(applied.assigned).toBe(true);
    expect(applied.highlight).toBe(true);
    const undone = scene.reducer(applied, { type: "undo" });
    expect(undone.turns[0]?.change).toBe("undone");
    expect(undone.assigned).toBe(false);
  });

  it("cancels a proposal, directly or by sending something new", () => {
    const ready = run(...sent("build", demo.ask.buildPrompt), ...answered);
    expect(scene.reducer(ready, { type: "cancel" }).turns[0]?.change).toBe(
      "cancelled",
    );
    const moved = run(
      ...sent("build", demo.ask.buildPrompt),
      ...answered,
      { type: "input", value: "Never mind" },
      { type: "send" },
    );
    expect(moved.turns[0]?.change).toBe("cancelled");
    expect(moved.assigned).toBe(false);
  });
});
