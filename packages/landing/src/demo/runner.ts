import { isDemoCancelled, type Timeline } from "./timeline";
import type {
  Anchor,
  CursorId,
  CursorKind,
  Point,
  Step,
  TargetBox,
} from "./types";

export type CursorFrame = Point & {
  kind: CursorKind;
  pressed: boolean;
  visible: boolean;
};

/** What the runner drives. `DemoStage` implements it on the DOM. */
export type DemoHost<A> = {
  dispatch: (action: A) => void;
  /** Back to the initial state, before each loop. */
  reset: () => void;
  /** The target's box in stage pixels, or null when it is not rendered. */
  locate: (target: string) => TargetBox | null;
  cursor: (id: CursorId, frame: CursorFrame) => void;
  ripple: (id: CursorId, at: Point) => void;
  /** Shows a key-hint chip; null hides it. */
  hint: (combo: string | null) => void;
  /** Lifts a target off the page and offsets it; null drops it back. */
  lift: (target: string, offset: Point | null) => void;
  /** Plans a scroll that brings the target into view; null if none. */
  scroll: (target: string) => {
    from: Point;
    to: Point;
    apply: (position: Point) => void;
  } | null;
};

export type RunOptions<A> = {
  steps: readonly Step<A>[];
  host: DemoHost<A>;
  timeline: Timeline;
  /** Where cursors rest before the first move. */
  home: Point;
  /** Where the collaborator's cursor starts. Defaults to `home`. */
  collabHome?: Point;
  loop?: boolean;
  /** The pause between the end of the script and the next loop, in ms. */
  loopDelay?: number;
};

/** Smooth start, gentle landing (CSS `cubic-bezier(.45, 0, .2, 1)`-like). */
export function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function aim(box: TargetBox, anchor: Anchor = {}): Point {
  return {
    x: box.x + box.width * (anchor.x ?? 0.5),
    y: box.y + box.height * (anchor.y ?? 0.5),
  };
}

/** Hand-like travel: longer moves take longer, within limits. */
export function travelTime(from: Point, to: Point): number {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  return Math.round(Math.min(950, Math.max(320, 260 + distance * 0.75)));
}

/** A slight arc, as a hand moves, through a quadratic bezier. */
function arcPoint(from: Point, to: Point, t: number): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const control = {
    x: from.x + dx * 0.5 - dy * 0.12,
    y: from.y + dy * 0.5 + dx * 0.08,
  };
  const u = 1 - t;
  return {
    x: u * u * from.x + 2 * u * t * control.x + t * t * to.x,
    y: u * u * from.y + 2 * u * t * control.y + t * t * to.y,
  };
}

/**
 * Plays a script on a host, step by step, on the timeline's play time.
 * Resolves when the script ends (never, when looping) or the timeline is
 * cancelled; any other error is rethrown.
 */
export async function runScript<A>(options: RunOptions<A>): Promise<void> {
  const { steps, host, timeline, loop = false, loopDelay = 2400 } = options;
  const cursors: Record<CursorId, CursorFrame> = {
    main: { ...options.home, kind: "pointer", pressed: false, visible: true },
    collab: {
      ...(options.collabHome ?? options.home),
      kind: "pointer",
      pressed: false,
      visible: false,
    },
  };
  const lifted = new Set<string>();

  const show = (id: CursorId, patch: Partial<CursorFrame>) => {
    cursors[id] = { ...cursors[id], ...patch };
    host.cursor(id, cursors[id]);
  };

  const moveTo = async (
    id: CursorId,
    to: Point,
    duration?: number,
    onFrame?: (at: Point) => void,
  ) => {
    const from = { x: cursors[id].x, y: cursors[id].y };
    if (!cursors[id].visible) {
      // A cursor appears where its first move ends.
      show(id, { ...to, visible: true });
      return;
    }
    if (Math.hypot(to.x - from.x, to.y - from.y) < 1) return;
    await timeline.wait(duration ?? travelTime(from, to), (progress) => {
      const at = arcPoint(from, to, easeInOut(progress));
      show(id, at);
      onFrame?.(at);
    });
  };

  const run = async (list: readonly Step<A>[]): Promise<void> => {
    for (const item of list) {
      await runStep(item);
    }
  };

  const runStep = async (item: Step<A>): Promise<void> => {
    switch (item.kind) {
      case "move": {
        const box = host.locate(item.target);
        if (!box) return;
        const id = item.cursor ?? "main";
        await moveTo(id, aim(box, item.anchor), item.duration);
        show(id, { kind: box.cursor ?? "pointer" });
        return;
      }
      case "click": {
        const id = item.cursor ?? "main";
        const box = host.locate(item.target);
        if (box) {
          await moveTo(id, aim(box, item.anchor), item.duration);
          show(id, { kind: box.cursor ?? "pointer", pressed: true });
          host.ripple(id, { x: cursors[id].x, y: cursors[id].y });
          await timeline.wait(110);
        }
        if (item.action !== undefined) host.dispatch(item.action);
        show(id, { pressed: false });
        await timeline.wait(220);
        return;
      }
      case "type": {
        const delay = 1000 / Math.max(1, item.cps);
        for (let index = 1; index <= item.text.length; index++) {
          host.dispatch(item.toAction(item.text.slice(0, index)));
          // A beat longer after a space, like a person typing.
          const typed = item.text[index - 1];
          await timeline.wait(typed === " " ? delay * 1.8 : delay);
        }
        return;
      }
      case "key": {
        host.hint(item.combo);
        await timeline.wait(280);
        if (item.action !== undefined) host.dispatch(item.action);
        await timeline.wait(520);
        host.hint(null);
        return;
      }
      case "drag": {
        const fromBox = host.locate(item.from);
        const toBox = host.locate(item.to);
        if (!fromBox || !toBox) {
          if (item.action !== undefined) host.dispatch(item.action);
          return;
        }
        const grip = aim(fromBox);
        await moveTo("main", grip);
        show("main", { kind: "grab", pressed: true });
        await timeline.wait(140);
        lifted.add(item.from);
        host.lift(item.from, { x: 0, y: 0 });
        await moveTo(
          "main",
          aim(toBox, item.anchor),
          item.duration ?? 900,
          (at) => {
            host.lift(item.from, { x: at.x - grip.x, y: at.y - grip.y });
          },
        );
        await timeline.wait(90);
        host.lift(item.from, null);
        lifted.delete(item.from);
        if (item.action !== undefined) host.dispatch(item.action);
        show("main", { kind: "pointer", pressed: false });
        await timeline.wait(200);
        return;
      }
      case "wait":
        await timeline.wait(item.ms);
        return;
      case "set":
        host.dispatch(item.action);
        // One frame, so the view has rendered before the next step aims.
        await timeline.wait(0);
        return;
      case "scroll": {
        const plan = host.scroll(item.target);
        if (!plan) return;
        await timeline.wait(item.duration ?? 600, (progress) => {
          const t = easeInOut(progress);
          plan.apply({
            x: plan.from.x + (plan.to.x - plan.from.x) * t,
            y: plan.from.y + (plan.to.y - plan.from.y) * t,
          });
        });
        return;
      }
      case "parallel":
        await Promise.all(item.tracks.map((track) => run(track)));
        return;
    }
  };

  try {
    do {
      host.reset();
      show("main", { ...options.home, kind: "pointer", pressed: false });
      show("collab", {
        ...(options.collabHome ?? options.home),
        pressed: false,
        visible: false,
      });
      await timeline.wait(0);
      await run(steps);
      if (loop) await timeline.wait(loopDelay);
    } while (loop && !timeline.cancelled);
  } catch (error) {
    if (!isDemoCancelled(error)) throw error;
  } finally {
    for (const target of lifted) host.lift(target, null);
    host.hint(null);
  }
}
