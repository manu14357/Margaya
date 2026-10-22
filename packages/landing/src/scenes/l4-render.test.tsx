import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import messages from "../../../../i18n/en-US.json";
import { LandingCopyProvider } from "../copy";
import { type DemoScene, finalStateOf, scriptActions } from "../demo";
import { type LandingLinks, LandingLinksProvider } from "../links";
import { createAnalyticsScene } from "./analytics/analytics-scene";
import { ApiDemo } from "./api/api-card";
import { createAskScene } from "./ask/ask-scene";
import { createAuditLogScene } from "./audit-log/audit-log-scene";
import { createDocsScene } from "./docs/docs-scene";
import { createIntegrationsScene } from "./integrations/integrations-scene";
import { createJiraScene } from "./jira/jira-scene";
import { createMcpScene } from "./mcp/mcp-scene";
import { createPublicBoardScene } from "./public-board/public-board-scene";
import { createTrashScene } from "./trash/trash-scene";

const copy = messages.landing;
const demo = copy.demo;

const links = {
  home: "/",
  signIn: "/sign-in",
  signUp: "/sign-up",
  selfHost: "/docs/install",
  docs: "/docs",
  apiReference: "/docs/api",
  pricing: "/pricing",
  github: "https://example.com/margaya",
  features: {
    plan: "/features/plan",
    views: "/features/views",
    ai: "/features/ai",
    docs: "/features/docs",
    automate: "/features/automate",
    selfHost: "/features/self-host",
  },
} as LandingLinks;

// biome-ignore lint/suspicious/noExplicitAny: scenes differ in state types.
const scenes: DemoScene<any, any>[] = [
  createDocsScene(demo),
  createDocsScene(demo, "together"),
  createDocsScene(demo, "slash"),
  createDocsScene(demo, "tasks"),
  createAnalyticsScene(),
  createAuditLogScene(),
  createTrashScene(),
  createIntegrationsScene(),
  createMcpScene(demo),
  createAskScene(demo),
  createJiraScene(),
  createPublicBoardScene(demo),
];

function show(node: React.ReactNode) {
  return render(
    <LandingCopyProvider copy={copy}>
      <LandingLinksProvider links={links}>{node}</LandingLinksProvider>
    </LandingCopyProvider>,
  );
}

afterEach(cleanup);

describe("L4 scenes render", () => {
  for (const scene of scenes) {
    it(`${scene.id}: renders the first and final frames, wide and compact`, () => {
      for (const state of [scene.initialState, finalStateOf(scene)]) {
        for (const compact of [false, true]) {
          const view = show(
            scene.render({
              state,
              dispatch: () => {},
              interactive: false,
              compact,
            }),
          );
          expect(view.container.textContent).not.toBe("");
          view.unmount();
        }
      }
    });

    it(`${scene.id}: every scripted target exists when the script reaches it`, () => {
      // Replays the script, rendering each frame, and checks the next
      // step's target is on screen (a missing one would be silently skipped).
      let state = scene.initialState;
      const missing: string[] = [];
      const steps: typeof scene.script = scene.script.flatMap((item) =>
        item.kind === "parallel" ? item.tracks.flat() : [item],
      );
      for (const item of steps) {
        const view = show(
          scene.render({
            state,
            dispatch: () => {},
            interactive: false,
            compact: false,
          }),
        );
        const aims =
          item.kind === "drag"
            ? [item.from, item.to]
            : "target" in item
              ? [item.target]
              : [];
        for (const target of aims) {
          if (!view.container.querySelector(`[data-demo="${target}"]`)) {
            missing.push(target);
          }
        }
        view.unmount();
        for (const action of scriptActions([item])) {
          state = scene.reducer(state, action);
        }
      }
      expect(missing).toEqual([]);
    });
  }

  it("api: renders the snippet with its caption", () => {
    const view = show(<ApiDemo />);
    expect(view.container.textContent).toContain("/api/task/$PROJECT_ID");
    expect(view.container.textContent).toContain(copy.scenes.api.caption);
  });
});
