"use client";

import { useEffect } from "react";
import type { DemoScene, Step } from "../../demo";

export type Signalled<S> = { inner: S; ended: boolean };
export type SignalledAction<A> = { kind: "inner"; action: A } | { kind: "end" };

function mapSteps<A, B>(steps: readonly Step<A>[], to: (action: A) => B) {
  return steps.map((item): Step<B> => {
    switch (item.kind) {
      case "click":
      case "key":
      case "drag":
        return {
          ...item,
          action: item.action === undefined ? undefined : to(item.action),
        };
      case "set":
        return { ...item, action: to(item.action) };
      case "type":
        return { ...item, toAction: (value) => to(item.toAction(value)) };
      case "parallel":
        return {
          ...item,
          tracks: item.tracks.map((track) => mapSteps(track, to)),
        };
      default:
        return item;
    }
  });
}

function EndWatch({ ended, onEnd }: { ended: boolean; onEnd: () => void }) {
  useEffect(() => {
    if (ended) onEnd();
  }, [ended, onEnd]);
  return null;
}

/**
 * Wraps a scene so it reports the end of its script: the last step flips
 * `ended`, and the view calls `onEnd` once it renders that. The views
 * section uses it to advance to the next tab. With reduced motion the still
 * frame is already ended, so callers must ignore `onEnd` then.
 */
export function withEndSignal<S, A>(
  scene: DemoScene<S, A>,
  onEnd: () => void,
): DemoScene<Signalled<S>, SignalledAction<A>> {
  const wrap = (action: A): SignalledAction<A> => ({ kind: "inner", action });
  return {
    id: scene.id,
    initialState: { inner: scene.initialState, ended: false },
    reducer: (state, action) =>
      action.kind === "end"
        ? { ...state, ended: true }
        : { ...state, inner: scene.reducer(state.inner, action.action) },
    script: [
      ...mapSteps(scene.script, wrap),
      { kind: "set", action: { kind: "end" } },
    ],
    finalState:
      scene.finalState === undefined
        ? undefined
        : { inner: scene.finalState, ended: true },
    render: ({ state, dispatch, ...rest }) => (
      <>
        {scene.render({
          ...rest,
          state: state.inner,
          dispatch: (action: A) => dispatch(wrap(action)),
        })}
        <EndWatch ended={state.ended} onEnd={onEnd} />
      </>
    ),
  };
}
