import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import messages from "../../../../../i18n/en-US.json";
import { LandingCopyProvider } from "../../copy";
import { type DemoScene, finalStateOf, scriptActions } from "../../demo";
import { createCyclesScene } from "../cycles/cycles-scene";
import { DigestPreview } from "../digest/digest-preview";
import { createHomeScene } from "../home/home-scene";
import { createInboxScene } from "../inbox/inbox-scene";
import { createIntakeScene } from "../intake/intake-scene";
import { createModulesScene } from "../modules/modules-scene";
import { createYourWorkScene } from "../your-work/your-work-scene";

const demo = messages.landing.demo;

function withCopy(node: ReactNode) {
  return (
    <LandingCopyProvider copy={messages.landing}>{node}</LandingCopyProvider>
  );
}

// biome-ignore lint/suspicious/noExplicitAny: scenes differ in state and action types.
const scenes: DemoScene<any, any>[] = [
  createCyclesScene(demo),
  createModulesScene(demo),
  createIntakeScene(demo),
  createInboxScene(demo),
  createHomeScene(demo),
  createYourWorkScene(),
];

describe("L3 scene views", () => {
  for (const scene of scenes) {
    it(`${scene.id}: renders every script target in the right state`, () => {
      for (const compact of [false, true]) {
        for (const state of [scene.initialState, finalStateOf(scene)]) {
          const { container, unmount } = render(
            withCopy(
              scene.render({
                state,
                dispatch: () => {},
                interactive: false,
                compact,
              }),
            ),
          );
          expect(container.textContent).not.toBe("");
          unmount();
        }
      }
    }, 30_000);
  }

  it("every script target exists when its step runs", () => {
    for (const scene of scenes) {
      let state = scene.initialState;
      for (const item of scene.script) {
        if (
          item.kind === "click" ||
          item.kind === "move" ||
          item.kind === "type"
        ) {
          const { container, unmount } = render(
            withCopy(
              scene.render({
                state,
                dispatch: () => {},
                interactive: false,
                compact: false,
              }),
            ),
          );
          expect(
            container.querySelector(`[data-demo="${item.target}"]`),
            `${scene.id}: ${item.target}`,
          ).not.toBeNull();
          unmount();
        }
        for (const action of scriptActions([item])) {
          state = scene.reducer(state, action);
        }
      }
    }
    // Many renders: generous under a parallel, loaded test run.
  }, 30_000);

  it("renders the digest preview from copy", () => {
    const { getByText } = render(withCopy(<DigestPreview />));
    expect(getByText(demo.digest.openInbox)).toBeTruthy();
  });
});
