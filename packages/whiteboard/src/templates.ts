// Starter boards. Templates contain no copy of their own: the caller passes
// the translated labels, keyed by the entries in TEMPLATE_LABEL_KEYS.

import { createElement, type ElementOptions } from "./create.js";
import type { BoardElement, ElementOf, ElementType } from "./elements.js";
import { updateBoundLines } from "./geometry.js";
import { newElementId } from "./ids.js";
import { ordersBetween } from "./order.js";

export const BOARD_TEMPLATE_IDS = [
  "blank",
  "brainstorm",
  "retrospective",
  "sprint-planning",
  "user-story-map",
  "roadmap",
  "flowchart",
  "kanban",
] as const;
export type BoardTemplateId = (typeof BOARD_TEMPLATE_IDS)[number];

export const TEMPLATE_LABEL_KEYS: Record<BoardTemplateId, string[]> = {
  blank: [],
  brainstorm: ["brainstorm.topic", "brainstorm.ideas"],
  retrospective: [
    "retrospective.title",
    "retrospective.wentWell",
    "retrospective.toImprove",
    "retrospective.actions",
  ],
  "sprint-planning": [
    "sprintPlanning.title",
    "sprintPlanning.goal",
    "sprintPlanning.backlog",
    "sprintPlanning.committed",
    "sprintPlanning.risks",
  ],
  "user-story-map": [
    "userStoryMap.title",
    "userStoryMap.activity",
    "userStoryMap.story",
    "userStoryMap.release1",
    "userStoryMap.release2",
  ],
  roadmap: ["roadmap.title", "roadmap.now", "roadmap.next", "roadmap.later"],
  flowchart: [
    "flowchart.start",
    "flowchart.step",
    "flowchart.decision",
    "flowchart.yes",
    "flowchart.no",
    "flowchart.end",
  ],
  kanban: ["kanban.todo", "kanban.doing", "kanban.done"],
};

export function isBoardTemplateId(value: unknown): value is BoardTemplateId {
  return (
    typeof value === "string" &&
    (BOARD_TEMPLATE_IDS as readonly string[]).includes(value)
  );
}

export type TemplateOptions = ElementOptions & {
  /** Top-left corner of the template on the board (default 0, 0). */
  origin?: { x: number; y: number };
};

const STICKY_COLORS = ["#fff3bf", "#d3f9d8", "#d0ebff", "#ffd8e8", "#e5dbff"];

type Builder = {
  add<T extends ElementType>(
    type: T,
    props: Partial<Omit<ElementOf<T>, "type">>,
  ): ElementOf<T>;
  label(key: string): string;
};

function title(b: Builder, key: string, x: number, y: number) {
  b.add("text", {
    x,
    y,
    width: 600,
    height: 45,
    fontSize: 36,
    text: b.label(key),
  });
}

function stickies(
  b: Builder,
  x: number,
  y: number,
  count: number,
  color: string,
  frameId: string | null = null,
) {
  for (let i = 0; i < count; i++) {
    b.add("sticky", {
      x: x + (i % 2) * 220,
      y: y + Math.floor(i / 2) * 220,
      fillColor: color,
      frameId,
    });
  }
}

function columns(
  b: Builder,
  keys: string[],
  y: number,
  width: number,
  height: number,
  stickiesPer: number,
) {
  keys.forEach((key, i) => {
    const frame = b.add("frame", {
      x: i * (width + 40),
      y,
      width,
      height,
      name: b.label(key),
    });
    stickies(
      b,
      frame.x + 20,
      frame.y + 20,
      stickiesPer,
      STICKY_COLORS[i % STICKY_COLORS.length],
      frame.id,
    );
  });
}

const BUILDERS: Record<BoardTemplateId, (b: Builder) => void> = {
  blank: () => {},
  brainstorm: (b) => {
    const center = { x: 600, y: 400 };
    b.add("ellipse", {
      x: center.x - 160,
      y: center.y - 90,
      width: 320,
      height: 180,
      fillColor: "#e7f5ff",
      fontSize: 28,
      text: b.label("brainstorm.topic"),
    });
    b.add("text", {
      x: 40,
      y: 0,
      width: 400,
      height: 30,
      fontSize: 24,
      text: b.label("brainstorm.ideas"),
    });
    const count = 8;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      b.add("sticky", {
        x: center.x + Math.cos(angle) * 420 - 100,
        y: center.y + Math.sin(angle) * 300 - 100,
        fillColor: STICKY_COLORS[i % STICKY_COLORS.length],
      });
    }
  },
  retrospective: (b) => {
    title(b, "retrospective.title", 0, -80);
    columns(
      b,
      [
        "retrospective.wentWell",
        "retrospective.toImprove",
        "retrospective.actions",
      ],
      0,
      480,
      720,
      4,
    );
  },
  "sprint-planning": (b) => {
    title(b, "sprintPlanning.title", 0, -80);
    const goal = b.add("frame", {
      x: 0,
      y: 0,
      width: 1560,
      height: 200,
      name: b.label("sprintPlanning.goal"),
    });
    b.add("text", {
      x: goal.x + 20,
      y: goal.y + 20,
      width: 1400,
      height: 30,
      frameId: goal.id,
    });
    const keys = [
      "sprintPlanning.backlog",
      "sprintPlanning.committed",
      "sprintPlanning.risks",
    ];
    keys.forEach((key, i) => {
      const frame = b.add("frame", {
        x: i * 520,
        y: 260,
        width: 480,
        height: 720,
        name: b.label(key),
      });
      stickies(b, frame.x + 20, frame.y + 20, 2, STICKY_COLORS[i], frame.id);
    });
  },
  "user-story-map": (b) => {
    title(b, "userStoryMap.title", 0, -80);
    const activities = 4;
    for (let i = 0; i < activities; i++) {
      b.add("sticky", {
        x: i * 240,
        y: 0,
        fillColor: "#d0ebff",
        text: b.label("userStoryMap.activity"),
      });
      b.add("sticky", {
        x: i * 240,
        y: 300,
        width: 200,
        height: 140,
        fillColor: STICKY_COLORS[0],
        text: b.label("userStoryMap.story"),
      });
    }
    const width = activities * 240 - 40;
    [260, 520].forEach((y, i) => {
      b.add("line", {
        x: -40,
        y,
        strokeStyle: "dashed",
        points: [
          [0, 0],
          [width + 80, 0],
        ],
      });
      b.add("text", {
        x: width + 60,
        y: y - 14,
        width: 200,
        height: 28,
        text: b.label(
          i === 0 ? "userStoryMap.release1" : "userStoryMap.release2",
        ),
      });
    });
  },
  roadmap: (b) => {
    title(b, "roadmap.title", 0, -120);
    b.add("arrow", {
      x: 0,
      y: -30,
      strokeWidth: 4,
      points: [
        [0, 0],
        [1520, 0],
      ],
    });
    columns(
      b,
      ["roadmap.now", "roadmap.next", "roadmap.later"],
      0,
      480,
      600,
      4,
    );
  },
  flowchart: (b) => {
    const node = <T extends "ellipse" | "rectangle" | "diamond">(
      type: T,
      key: string,
      y: number,
    ) =>
      b.add(type, {
        x: 200 - (type === "diamond" ? 100 : 90),
        y,
        width: type === "diamond" ? 200 : 180,
        height: type === "diamond" ? 140 : 80,
        text: b.label(key),
      } as Partial<Omit<ElementOf<T>, "type">>);
    const start = node("ellipse", "flowchart.start", 0);
    const step = node("rectangle", "flowchart.step", 160);
    const decision = node("diamond", "flowchart.decision", 320);
    const yes = b.add("rectangle", {
      x: 110,
      y: 560,
      width: 180,
      height: 80,
      text: b.label("flowchart.step"),
    });
    const end = node("ellipse", "flowchart.end", 720);
    // The other branch produces a document, drawn with its wavy-bottom shape.
    const no = b.add("shape", {
      shape: "document",
      x: 480,
      y: 345,
      width: 180,
      height: 90,
      text: b.label("flowchart.step"),
    });
    const link = (
      from: BoardElement,
      to: BoardElement,
      text = "",
      routing: "straight" | "elbow" = "straight",
    ) =>
      b.add("arrow", {
        text,
        routing,
        startBinding: { elementId: from.id, focus: [0.5, 0.5], gap: 6 },
        endBinding: { elementId: to.id, focus: [0.5, 0.5], gap: 6 },
      });
    link(start, step);
    link(step, decision);
    link(decision, yes, b.label("flowchart.yes"));
    link(decision, no, b.label("flowchart.no"));
    link(yes, end);
  },
  kanban: (b) => {
    columns(b, ["kanban.todo", "kanban.doing", "kanban.done"], 0, 480, 800, 3);
  },
};

/**
 * Fresh elements for a template, ready to write to a new board. `labels`
 * maps each key in TEMPLATE_LABEL_KEYS[id] to translated copy; a missing
 * label falls back to its key.
 */
export function templateElements(
  id: BoardTemplateId,
  labels: Record<string, string>,
  options?: TemplateOptions,
): BoardElement[] {
  const build = BUILDERS[id];
  if (!build) return [];
  const created: BoardElement[] = [];
  const builder: Builder = {
    add(type, props) {
      const element = createElement(
        type,
        { ...props, id: newElementId() },
        options,
      );
      created.push(element);
      return element;
    },
    label: (key) => labels[key] ?? key,
  };
  build(builder);
  if (created.length === 0) return [];

  // Frames sit below everything; the rest keep their creation order.
  const ordered = [
    ...created.filter((element) => element.type === "frame"),
    ...created.filter((element) => element.type !== "frame"),
  ];
  const keys = ordersBetween(null, null, ordered.length);
  const origin = options?.origin ?? { x: 0, y: 0 };
  let elements = ordered.map((element, i) => ({
    ...element,
    order: keys[i],
    x: element.x + origin.x,
    y: element.y + origin.y,
  })) as BoardElement[];

  // Bound arrows were created without geometry; route them now.
  const routed = updateBoundLines(
    elements,
    elements
      .filter((element) => element.type !== "arrow")
      .map((element) => element.id),
    options,
  );
  const byId = new Map(
    routed.map((element) => [element.id, { ...element, version: 1 }]),
  );
  elements = elements.map((element) => byId.get(element.id) ?? element);
  return elements;
}
