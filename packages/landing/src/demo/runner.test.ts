import { describe, expect, it } from "vitest";
import { type DemoHost, runScript } from "./runner";
import { finalStateOf, step } from "./steps";
import { createTimeline, type FrameScheduler } from "./timeline";
import type { DemoScene, Step } from "./types";

/** A frame source the test advances by hand, 16 ms per frame. */
function manualFrames() {
  let nextId = 0;
  let time = 0;
  const queue = new Map<number, (time: number) => void>();
  const scheduler: FrameScheduler = {
    request: (callback) => {
      nextId += 1;
      queue.set(nextId, callback);
      return nextId;
    },
    cancel: (id) => {
      queue.delete(id);
    },
  };
  const flush = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  return {
    scheduler,
    async advance(ms: number) {
      for (let elapsed = 0; elapsed < ms; elapsed += 16) {
        time += 16;
        const callbacks = [...queue.values()];
        queue.clear();
        for (const callback of callbacks) callback(time);
        await flush();
      }
    },
    flush,
  };
}

type Log = string[];

function fakeHost(log: Log): DemoHost<string> {
  const box = { x: 10, y: 10, width: 100, height: 40 };
  return {
    dispatch: (action) => log.push(`dispatch:${action}`),
    reset: () => log.push("reset"),
    locate: (target) => (target === "missing" ? null : box),
    cursor: () => {},
    ripple: (_id, _at) => log.push("ripple"),
    hint: (combo) => log.push(`hint:${combo}`),
    lift: (target, offset) => {
      if (offset === null) log.push(`drop:${target}`);
      else if (offset.x === 0 && offset.y === 0) log.push(`lift:${target}`);
    },
    scroll: () => null,
  };
}

function start(steps: Step<string>[], options: { loop?: boolean } = {}) {
  const frames = manualFrames();
  const timeline = createTimeline(frames.scheduler);
  const log: Log = [];
  timeline.play();
  const done = runScript({
    steps,
    host: fakeHost(log),
    timeline,
    home: { x: 0, y: 0 },
    loop: options.loop,
    loopDelay: 100,
  });
  return { frames, timeline, log, done };
}

const dispatched = (log: Log) =>
  log.filter((entry) => entry.startsWith("dispatch:"));

describe("runScript", () => {
  it("runs steps in order and waits on play time", async () => {
    const { frames, log, done } = start([
      step.set("a"),
      step.wait(200),
      step.click("button", "b"),
      step.key("Enter", "c"),
      step.type("field", "hi", (value) => `typed ${value}`),
      step.drag("card", "column", "d"),
    ]);

    await frames.advance(100);
    expect(dispatched(log)).toEqual(["dispatch:a"]);

    await frames.advance(10_000);
    await done;
    expect(dispatched(log)).toEqual([
      "dispatch:a",
      "dispatch:b",
      "dispatch:c",
      "dispatch:typed h",
      "dispatch:typed hi",
      "dispatch:d",
    ]);
    expect(log.indexOf("hint:Enter")).toBeLessThan(log.indexOf("dispatch:c"));
    expect(log.indexOf("ripple")).toBeLessThan(log.indexOf("dispatch:b"));
    expect(log.indexOf("lift:card")).toBeLessThan(log.indexOf("drop:card"));
    expect(log.indexOf("drop:card")).toBeLessThan(log.indexOf("dispatch:d"));
  });

  it("still dispatches a click whose target is not rendered", async () => {
    const { frames, log, done } = start([step.click("missing", "x")]);
    await frames.advance(1000);
    await done;
    expect(dispatched(log)).toEqual(["dispatch:x"]);
    expect(log).not.toContain("ripple");
  });

  it("runs parallel tracks together", async () => {
    const { frames, log, done } = start([
      step.parallel(
        [step.wait(300), step.set("slow")],
        [step.wait(100), step.set("fast")],
      ),
      step.set("after"),
    ]);
    await frames.advance(2000);
    await done;
    expect(dispatched(log)).toEqual([
      "dispatch:fast",
      "dispatch:slow",
      "dispatch:after",
    ]);
  });

  it("stops for good when cancelled, and resolves quietly", async () => {
    const { frames, timeline, log, done } = start([
      step.wait(500),
      step.set("never"),
    ]);
    await frames.advance(100);
    timeline.cancel();
    await expect(done).resolves.toBeUndefined();
    await frames.advance(2000);
    expect(dispatched(log)).toEqual([]);
    expect(log.at(-1)).toBe("hint:null");
  });

  it("freezes while paused and resumes where it was", async () => {
    const { frames, timeline, log } = start([step.wait(300), step.set("done")]);
    await frames.advance(160);
    timeline.pause();
    await frames.advance(2000);
    expect(dispatched(log)).toEqual([]);
    timeline.play();
    await frames.advance(120);
    expect(dispatched(log)).toEqual([]);
    await frames.advance(200);
    expect(dispatched(log)).toEqual(["dispatch:done"]);
  });

  it("loops with a reset before each pass", async () => {
    const { frames, timeline, log } = start([step.set("x")], { loop: true });
    await frames.advance(600);
    timeline.cancel();
    expect(dispatched(log).length).toBeGreaterThanOrEqual(2);
    expect(log.filter((entry) => entry === "reset").length).toBe(
      dispatched(log).length,
    );
  });
});

describe("finalStateOf", () => {
  const scene: DemoScene<string[], string> = {
    id: "test",
    initialState: [],
    reducer: (state, action) => [...state, action],
    script: [
      step.click("a", "open"),
      step.type("b", "abc", (value) => `text:${value}`),
      step.wait(100),
      step.parallel([step.set("left")], [step.key("Enter", "right")]),
    ],
    render: () => null,
  };

  it("applies every scripted action once, typing in full", () => {
    expect(finalStateOf(scene)).toEqual(["open", "text:abc", "left", "right"]);
  });

  it("prefers an explicit final state", () => {
    expect(finalStateOf({ ...scene, finalState: ["still"] })).toEqual([
      "still",
    ]);
  });
});
