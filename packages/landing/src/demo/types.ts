import type { ReactNode } from "react";

/** A point in stage (design) pixels, from the stage's top-left corner. */
export type Point = { x: number; y: number };

/** A `data-demo` target's box in stage pixels. */
export type TargetBox = Point & {
  width: number;
  height: number;
  /** The cursor to show over it (`text` over inputs). */
  cursor?: CursorKind;
};

export type CursorKind = "pointer" | "grab" | "text";

/** `main` is the visitor's cursor; `collab` is a teammate's, with a name tag. */
export type CursorId = "main" | "collab";

/** Where on a target to aim, as fractions of its box. Defaults to the centre. */
export type Anchor = { x?: number; y?: number };

type CursorOptions = {
  cursor?: CursorId;
  anchor?: Anchor;
  /** Travel time in ms. Defaults to a distance-based duration. */
  duration?: number;
};

/** One instruction of a scene script. Build them with `step.*`. */
export type Step<A> =
  | ({ kind: "move"; target: string } & CursorOptions)
  | ({ kind: "click"; target: string; action?: A } & CursorOptions)
  | {
      kind: "type";
      target: string;
      text: string;
      /** Characters per second. */
      cps: number;
      /** The action for the text typed so far. */
      toAction: (value: string) => A;
    }
  | { kind: "key"; combo: string; action?: A }
  | {
      kind: "drag";
      from: string;
      to: string;
      action?: A;
      anchor?: Anchor;
      duration?: number;
    }
  | { kind: "wait"; ms: number }
  | { kind: "set"; action: A }
  | { kind: "scroll"; target: string; duration?: number }
  | { kind: "parallel"; tracks: readonly (readonly Step<A>[])[] };

export type SceneRenderProps<S, A> = {
  state: S;
  dispatch: (action: A) => void;
  /** False while the script plays: the replica is inert then. */
  interactive: boolean;
  /** True when the stage uses its compact (phone) size. */
  compact: boolean;
};

/**
 * A scripted scene: a tiny reducer, the script that drives it, and the view.
 * The view marks the script's targets with `data-demo="…"`.
 */
export type DemoScene<S, A> = {
  id: string;
  initialState: S;
  reducer: (state: S, action: A) => S;
  script: readonly Step<A>[];
  /**
   * The still frame for reduced motion. Defaults to applying every action
   * of the script, in order, to `initialState` (see `finalStateOf`).
   */
  finalState?: S;
  render: (props: SceneRenderProps<S, A>) => ReactNode;
};

export type StageSize = { width: number; height: number };
