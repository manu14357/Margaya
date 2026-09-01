import type { Anchor, CursorId, DemoScene, Step } from "./types";

type MoveOptions = { cursor?: CursorId; anchor?: Anchor; duration?: number };

/**
 * Script step builders. Targets are `data-demo` values inside the scene.
 *
 * ```ts
 * const script = [
 *   step.click("capture", { type: "focus" }),
 *   step.type("capture", "Fix login", (value) => ({ type: "input", value })),
 *   step.key("Enter", { type: "submit" }),
 * ];
 * ```
 */
export const step = {
  /** Glide a cursor to a target. */
  move: <A>(target: string, options: MoveOptions = {}): Step<A> => ({
    kind: "move",
    target,
    ...options,
  }),
  /** Move to a target if needed, press with a ripple, then dispatch. */
  click: <A>(
    target: string,
    action?: A,
    options: MoveOptions = {},
  ): Step<A> => ({
    kind: "click",
    target,
    action,
    ...options,
  }),
  /** Type `text` one character at a time, dispatching `toAction(prefix)`. */
  type: <A>(
    target: string,
    text: string,
    toAction: (value: string) => A,
    cps = 16,
  ): Step<A> => ({ kind: "type", target, text, cps, toAction }),
  /** Show a key-hint chip (e.g. "Enter", "Ctrl+K") and dispatch. */
  key: <A>(combo: string, action?: A): Step<A> => ({
    kind: "key",
    combo,
    action,
  }),
  /** Grab `from`, carry it to `to`, drop, then dispatch. */
  drag: <A>(
    from: string,
    to: string,
    action?: A,
    options: { anchor?: Anchor; duration?: number } = {},
  ): Step<A> => ({ kind: "drag", from, to, action, ...options }),
  /** Pause the script. */
  wait: <A>(ms: number): Step<A> => ({ kind: "wait", ms }),
  /** Dispatch without any cursor movement. */
  set: <A>(action: A): Step<A> => ({ kind: "set", action }),
  /** Scroll the target's `data-demo-scroll` container to show it. */
  scroll: <A>(target: string, duration?: number): Step<A> => ({
    kind: "scroll",
    target,
    duration,
  }),
  /** Run tracks at the same time, e.g. the collaborator's cursor. */
  parallel: <A>(...tracks: readonly (readonly Step<A>[])[]): Step<A> => ({
    kind: "parallel",
    tracks,
  }),
};

/** Every action a script dispatches, in order (a typed text counts once). */
export function scriptActions<A>(steps: readonly Step<A>[]): A[] {
  const actions: A[] = [];
  for (const item of steps) {
    switch (item.kind) {
      case "click":
      case "key":
      case "drag":
        if (item.action !== undefined) actions.push(item.action);
        break;
      case "set":
        actions.push(item.action);
        break;
      case "type":
        actions.push(item.toAction(item.text));
        break;
      case "parallel":
        for (const track of item.tracks) {
          actions.push(...scriptActions(track));
        }
        break;
      default:
        break;
    }
  }
  return actions;
}

/** The still frame shown with reduced motion. */
export function finalStateOf<S, A>(scene: DemoScene<S, A>): S {
  if (scene.finalState !== undefined) return scene.finalState;
  return scriptActions(scene.script).reduce(scene.reducer, scene.initialState);
}
