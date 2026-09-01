import { describe, expect, it } from "vitest";
import messages from "../../../../../i18n/en-US.json";
import { finalStateOf } from "../../demo";
import { createHeroScene } from "./hero-scene";
import { NEW_TASK_ID, parseCapture } from "./state";

const demo = messages.landing.demo;
const scene = createHeroScene(demo);

describe("hero scene", () => {
  it("parses the typed capture text into a title and tokens", () => {
    const vocabulary = {
      people: Object.values(demo.people),
      priorities: [{ word: "high", priority: "high" as const }],
      labels: [{ name: "bug", color: "red" as const }],
    };
    const { title, tokens } = parseCapture(demo.hero.typed, vocabulary);
    expect(title).toBe("Fix login redirect");
    expect(tokens.map((token) => token.kind)).toEqual([
      "assignee",
      "priority",
      "label",
    ]);
  });

  it("ends with the new task in progress and open in the sheet", () => {
    const final = finalStateOf(scene);
    const created = final.tasks.find((task) => task.id === NEW_TASK_ID);
    expect(created).toMatchObject({
      title: "Fix login redirect",
      status: "inProgress",
      priority: "high",
      assignees: [demo.people.adam.name],
      labels: [{ name: demo.labels.bug, color: "red" }],
    });
    expect(final.openTaskId).toBe(NEW_TASK_ID);
    expect(final.capture.text).toBe("");
  });

  it("puts the moved card at the top of its column", () => {
    const final = finalStateOf(scene);
    const inProgress = final.tasks.filter(
      (task) => task.status === "inProgress",
    );
    expect(inProgress[0]?.id).toBe(NEW_TASK_ID);
  });
});
