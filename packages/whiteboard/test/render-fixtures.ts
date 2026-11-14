import type { BoardElement, ElementOf, ElementType } from "../src/elements.js";
import type { RenderContext } from "../src/render/types.js";

let counter = 0;

const base = {
  x: 0,
  y: 0,
  width: 120,
  height: 80,
  angle: 0,
  strokeColor: "#1e1e1e",
  fillColor: "transparent",
  fillStyle: "none",
  strokeWidth: 2,
  strokeStyle: "solid",
  sketch: 1,
  opacity: 100,
  groupIds: [],
  frameId: null,
  locked: false,
  link: null,
  seed: 1234,
  version: 1,
  nonce: 1,
  deleted: false,
  updatedAt: 0,
  updatedBy: null,
} as const;

const text = {
  text: "",
  fontSize: 20,
  fontFamily: "hand",
  textAlign: "center",
  verticalAlign: "middle",
} as const;

const linear = {
  ...text,
  points: [
    [0, 0],
    [120, 80],
  ],
  routing: "straight",
  startHead: "none",
  endHead: "arrow",
  startBinding: null,
  endBinding: null,
} as const;

const extras: Record<ElementType, object> = {
  rectangle: { ...text, cornerRadius: 0 },
  ellipse: text,
  diamond: text,
  sticky: { ...text, fillColor: "#fff3bf" },
  text: {
    ...text,
    text: "Hello",
    textAlign: "left",
    verticalAlign: "top",
    autoSize: true,
  },
  arrow: linear,
  line: { ...linear, endHead: "none" },
  draw: {
    points: [
      [0, 0],
      [10, 4],
      [22, 10],
      [35, 12],
      [50, 20],
    ],
    pressures: [],
    simulatePressure: true,
    penStyle: "pen",
  },
  image: { assetId: null, crop: null },
  frame: { name: "Frame", width: 400, height: 300 },
  task: { taskId: "task-1", width: 240, height: 120 },
  shape: { ...text, shape: "star" },
};

export function makeElement<T extends ElementType>(
  type: T,
  props: Partial<ElementOf<T>> = {},
): ElementOf<T> {
  counter++;
  return {
    ...base,
    ...extras[type],
    id: `el-${counter}`,
    order: `a${String(counter).padStart(4, "0")}`,
    type,
    ...props,
  } as unknown as ElementOf<T>;
}

export function everyElement(): BoardElement[] {
  const frame = makeElement("frame", { name: "Sprint" });
  return [
    frame,
    makeElement("sticky", {
      text: "In a frame",
      x: 20,
      y: 20,
      frameId: frame.id,
    }),
    makeElement("rectangle", {
      text: "Box",
      fillStyle: "hatch",
      fillColor: "#a5d8ff",
    }),
    makeElement("rectangle", {
      cornerRadius: 12,
      fillStyle: "solid",
      fillColor: "#b2f2bb",
      strokeStyle: "dashed",
    }),
    makeElement("ellipse", {
      fillStyle: "cross",
      fillColor: "#ffc9c9",
      text: "Round",
    }),
    makeElement("diamond", {
      fillStyle: "solid",
      fillColor: "#ffec99",
      strokeStyle: "dotted",
      sketch: 2,
    }),
    makeElement("sticky", { text: "Sticky note text that wraps over lines" }),
    makeElement("text", { text: "Line one\nLine two" }),
    makeElement("text", {
      text: "Fixed width text that should wrap",
      autoSize: false,
      width: 80,
    }),
    makeElement("arrow", {
      startHead: "dot",
      endHead: "triangle",
      text: "label",
    }),
    makeElement("arrow", {
      routing: "curved",
      points: [
        [0, 0],
        [60, -40],
        [120, 20],
      ],
      endHead: "bar",
    }),
    makeElement("arrow", { routing: "elbow", endHead: "arrow", sketch: 0 }),
    makeElement("line", { sketch: 0 }),
    makeElement("draw"),
    makeElement("draw", {
      pressures: [0.2, 0.5, 0.8, 0.6, 0.3],
      simulatePressure: false,
    }),
    makeElement("image", { assetId: "asset-1" }),
    makeElement("image", {
      assetId: null,
      crop: { x: 0, y: 0, width: 10, height: 10 },
    }),
    makeElement("task", { taskId: "task-1" }),
    makeElement("task", { taskId: "missing" }),
    makeElement("rectangle", { angle: 0.6, opacity: 50 }),
    makeElement("shape", {
      shape: "cloud",
      text: "Idea",
      fillStyle: "hatch",
      fillColor: "#d0bfff",
    }),
    makeElement("shape", { shape: "cylinder", fillColor: "#b2f2bb" }),
    makeElement("draw", { penStyle: "marker" }),
    makeElement("draw", { penStyle: "highlighter", strokeColor: "#ffd43b" }),
  ];
}

export type Call = { name: string; args: unknown[] };

/** A 2D context that records every call and property write. */
export function recordingContext(): RenderContext & {
  calls: Call[];
  writes: { prop: string; value: unknown }[];
} {
  const calls: Call[] = [];
  const writes: { prop: string; value: unknown }[] = [];
  const state: Record<string, unknown> = {
    globalAlpha: 1,
    fillStyle: "#000000",
    strokeStyle: "#000000",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    font: "10px sans-serif",
    textAlign: "start",
    textBaseline: "alphabetic",
    shadowColor: "rgba(0, 0, 0, 0)",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
  };
  const target = { calls, writes } as Record<string, unknown>;
  const methods = [
    "save",
    "restore",
    "setTransform",
    "translate",
    "rotate",
    "beginPath",
    "moveTo",
    "lineTo",
    "bezierCurveTo",
    "closePath",
    "fill",
    "stroke",
    "clip",
    "setLineDash",
    "fillText",
    "fillRect",
    "clearRect",
    "drawImage",
  ];
  for (const name of methods) {
    target[name] = (...args: unknown[]) => {
      for (const arg of args) {
        if (typeof arg === "number" && !Number.isFinite(arg)) {
          throw new Error(`${name} got a non-finite number`);
        }
      }
      calls.push({ name, args });
    };
  }
  for (const prop of Object.keys(state)) {
    Object.defineProperty(target, prop, {
      get: () => state[prop],
      set: (value: unknown) => {
        writes.push({ prop, value });
        state[prop] = value;
      },
      enumerable: true,
    });
  }
  return target as unknown as RenderContext & {
    calls: Call[];
    writes: { prop: string; value: unknown }[];
  };
}

/** A deterministic measure: 0.6 em per character. */
export function fakeMeasure(value: string, font: string): number {
  const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16);
  return Array.from(value).length * size * 0.6;
}
