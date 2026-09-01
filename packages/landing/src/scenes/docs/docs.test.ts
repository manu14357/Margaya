import { describe, expect, it } from "vitest";
import messages from "../../../../../i18n/en-US.json";
import { finalStateOf } from "../../demo";
import { createDocsScene } from "./docs-scene";
import { docsReducer, filterSlash } from "./state";

const demo = messages.landing.demo;

describe("docs scene", () => {
  it("ends with both paragraphs written, a callout and the task chip", () => {
    const final = finalStateOf(createDocsScene(demo));
    expect(final.mine).toBe(demo.docs.mine);
    expect(final.collab).toBe(demo.docs.collab);
    expect(final.collabActive).toBe(true);
    expect(final.callout).toBe(demo.docs.callout);
    expect(final.slash.open).toBe(false);
    expect(final.chip).toBe(true);
    expect(final.preview).toBe(true);
  });

  it("tells one part of the story per variant", () => {
    const together = finalStateOf(createDocsScene(demo, "together"));
    expect(together.collab).toBe(demo.docs.collab);
    expect(together.callout).toBeNull();
    expect(together.chip).toBe(false);

    const slash = finalStateOf(createDocsScene(demo, "slash"));
    expect(slash.callout).toBe(demo.docs.callout);
    expect(slash.chip).toBe(false);

    const tasks = finalStateOf(createDocsScene(demo, "tasks"));
    expect(tasks.chip).toBe(true);
    expect(tasks.callout).toBe(demo.docs.callout);
  });

  it("narrows the slash menu as the query grows", () => {
    const labels = demo.docs.slashCommands;
    expect(filterSlash("", labels)).toHaveLength(9);
    expect(
      filterSlash(demo.docs.slashQuery, labels).map((command) => command.id),
    ).toEqual(["callout"]);
  });

  it("opens the menu on a slash and inserts only a callout", () => {
    const start = createDocsScene(demo, "slash").initialState;
    const open = docsReducer(start, { type: "slash", value: "/ca" });
    expect(open.slash).toEqual({ open: true, query: "ca" });
    const heading = docsReducer(open, {
      type: "pickSlash",
      command: "heading1",
    });
    expect(heading.slash.open).toBe(false);
    expect(heading.callout).toBeNull();
    const callout = docsReducer(open, {
      type: "pickSlash",
      command: "callout",
    });
    expect(callout.callout).toBe("");
    expect(callout.focus).toBe("callout");
  });

  it("only previews a chip that exists", () => {
    const start = createDocsScene(demo, "tasks").initialState;
    expect(docsReducer(start, { type: "preview", open: true }).preview).toBe(
      false,
    );
  });
});
