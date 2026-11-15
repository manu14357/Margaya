// These components read the board controller (history, collaborators,
// read-only state, the scene) while rendering. It is a mutable object whose
// identity never changes, so compiler memoisation would freeze those reads.
"use no memo";

import {
  type BoardElement,
  elementBox,
  fontCss,
  LINE_HEIGHT,
  type LinearElement,
  layoutText,
  shapeTextBox,
  type TextualElement,
  themeColor,
} from "@margaya/whiteboard";
import {
  type CSSProperties,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import type { BoardController } from "./controller";
import { measureText } from "./measure";
import { toScreen } from "./viewport";

// The text overlay: a real <textarea> placed exactly over the label it
// edits, so typing, IME, spell check and screen readers all work. The canvas
// hides that label while it is open. Enter adds a line; Escape or Ctrl+Enter
// (or clicking away) commits.

/** Label box paddings, matching the renderer. */
const CONTAINER_PADDING: Record<string, number> = {
  rectangle: 8,
  ellipse: 4,
  diamond: 2,
  sticky: 14,
  text: 0,
  shape: 2,
};

export type LabelBox = {
  x: number;
  y: number;
  width: number;
  /** Wrap width; Infinity for auto-sized text. */
  maxWidth: number;
  /** Height available (for vertical alignment); 0 for free text. */
  height: number;
};

/** Where the label of an element sits, in board units, before rotation. */
export function labelBox(element: BoardElement): LabelBox {
  const box = elementBox(element);
  switch (element.type) {
    case "text":
      return {
        x: box.x,
        y: box.y,
        width: box.width,
        maxWidth: element.autoSize
          ? Number.POSITIVE_INFINITY
          : Math.max(1, box.width),
        height: 0,
      };
    case "ellipse": {
      const insetX = (box.width * (1 - Math.SQRT1_2)) / 2;
      const insetY = (box.height * (1 - Math.SQRT1_2)) / 2;
      const pad = CONTAINER_PADDING.ellipse ?? 4;
      return {
        x: box.x + insetX + pad,
        y: box.y + insetY + pad,
        width: Math.max(1, box.width - insetX * 2 - pad * 2),
        maxWidth: Math.max(1, box.width - insetX * 2 - pad * 2),
        height: Math.max(1, box.height - insetY * 2 - pad * 2),
      };
    }
    case "diamond": {
      const pad = CONTAINER_PADDING.diamond ?? 2;
      return {
        x: box.x + box.width / 4 + pad,
        y: box.y + box.height / 4 + pad,
        width: Math.max(1, box.width / 2 - pad * 2),
        maxWidth: Math.max(1, box.width / 2 - pad * 2),
        height: Math.max(1, box.height / 2 - pad * 2),
      };
    }
    case "shape": {
      // The renderer lays the label out in this box; the editor must match.
      const inner = shapeTextBox(element.shape, box.width, box.height);
      const pad = CONTAINER_PADDING.shape ?? 2;
      const width = Math.max(1, inner.width - pad * 2);
      return {
        x: box.x + inner.x + pad,
        y: box.y + inner.y + pad,
        width,
        maxWidth: width,
        height: Math.max(1, inner.height - pad * 2),
      };
    }
    case "arrow":
    case "line": {
      const middle = polylineMiddle(element);
      const width = Math.max(160, element.fontSize * 14);
      return {
        x: middle.x - width / 2,
        y: middle.y,
        width,
        maxWidth: width,
        height: 0,
      };
    }
    default: {
      const pad = CONTAINER_PADDING[element.type] ?? 8;
      return {
        x: box.x + pad,
        y: box.y + pad,
        width: Math.max(1, box.width - pad * 2),
        maxWidth: Math.max(1, box.width - pad * 2),
        height: Math.max(1, box.height - pad * 2),
      };
    }
  }
}

function polylineMiddle(line: LinearElement): { x: number; y: number } {
  const points = line.points;
  let total = 0;
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1];
    const b = points[index];
    if (a && b) total += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  let remaining = total / 2;
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1];
    const b = points[index];
    if (!a || !b) continue;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (remaining <= length && length > 0) {
      const t = remaining / length;
      return {
        x: line.x + a[0] + (b[0] - a[0]) * t,
        y: line.y + a[1] + (b[1] - a[1]) * t,
      };
    }
    remaining -= length;
  }
  const first = points[0] ?? [0, 0];
  return { x: line.x + first[0], y: line.y + first[1] };
}

/** The size a free text element takes for `text`. */
export function measureTextElement(
  element: TextualElement & { type: "text" },
  text: string,
) {
  const layout = layoutText(
    text || " ",
    {
      fontSize: element.fontSize,
      fontFamily: element.fontFamily,
      maxWidth: element.autoSize
        ? Number.POSITIVE_INFINITY
        : Math.max(1, element.width),
    },
    measureText,
  );
  return {
    width: element.autoSize ? Math.max(1, layout.width) : element.width,
    height: Math.max(element.fontSize * LINE_HEIGHT, layout.height),
  };
}

/** A key press that an input method (Japanese, Chinese, ...) is handling. */
export function isComposingKey(event: {
  nativeEvent?: { isComposing?: boolean };
  keyCode?: number;
}): boolean {
  return Boolean(event.nativeEvent?.isComposing) || event.keyCode === 229;
}

type TextOverlayProps = {
  controller: BoardController;
  elementId: string;
  isNew: boolean;
  onDone: () => void;
};

export function TextOverlay({
  controller: c,
  elementId,
  isNew,
  onDone,
}: TextOverlayProps) {
  const { t } = useTranslation();
  const original = useRef<BoardElement | undefined>(c.get(elementId));
  const element = original.current;
  const isFrame = element?.type === "frame";
  const initial = element
    ? element.type === "frame"
      ? element.name
      : "text" in element
        ? element.text
        : ""
    : "";
  const [value, setValue] = useState(initial);
  const [, setTick] = useState(0);
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  const done = useRef(false);

  // Follow pans and zooms while typing.
  useEffect(
    () =>
      c.store.subscribe((state, previous) => {
        if (state.viewport !== previous.viewport) setTick((tick) => tick + 1);
      }),
    [c],
  );

  // Hide the canvas copy of the label while the textarea shows it.
  useLayoutEffect(() => {
    const current = original.current;
    if (!current) return;
    if (current.type === "frame")
      c.setPreview([{ ...current, name: "" }], { live: false });
    else if ("text" in current)
      c.setPreview([{ ...current, text: "" }], { live: false });
  }, [c]);

  // Focus after the pointer press that opened the editor has finished: the
  // press's own default focus change would otherwise blur (and close) it.
  const focused = useRef(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      const field = ref.current;
      if (!field) return;
      field.focus({ preventScroll: true });
      field.select();
      focused.current = true;
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  if (!element) return null;

  const commit = () => {
    if (done.current) return;
    done.current = true;
    const base = original.current;
    c.cancelPreview();
    if (!base) {
      onDone();
      return;
    }
    if (base.type === "frame") {
      const name = value.trim().slice(0, 200);
      if (name !== base.name) c.patch([base], { name });
    } else if ("text" in base) {
      const text = value.slice(0, 20_000);
      if (base.type === "text") {
        if (text.trim() === "") {
          if (!isNew) c.remove([base.id]);
        } else {
          const size = measureTextElement(base, text);
          const next = { ...base, text, ...size } as BoardElement;
          if (isNew) {
            c.insert([next]);
            c.dispatchTool({ type: "created" });
          } else if (text !== base.text) c.commit([next]);
        }
      } else if (text !== base.text) {
        c.patch([base], { text });
      }
    }
    onDone();
  };

  const zoom = c.state.viewport.zoom;
  const style: CSSProperties = { position: "absolute" };
  if (isFrame) {
    const box = elementBox(element);
    const top = toScreen(c.state.viewport, box.x, box.y);
    const height = 14 * 1.25;
    Object.assign(style, {
      left: top.x,
      top: top.y - (height + 6) * Math.min(1, Math.max(0.5, zoom)),
      width: Math.max(120, box.width * zoom),
      font: fontCss("sans", 14, 500),
    });
  } else if ("text" in element) {
    const label = labelBox(element);
    const layout = layoutText(
      value || " ",
      {
        fontSize: element.fontSize,
        fontFamily: element.fontFamily,
        maxWidth: label.maxWidth,
      },
      measureText,
    );
    let y = label.y;
    if (label.height > 0) {
      if (element.verticalAlign === "middle")
        y = label.y + (label.height - layout.height) / 2;
      else if (element.verticalAlign === "bottom")
        y = label.y + label.height - layout.height;
    } else if (element.type === "arrow" || element.type === "line") {
      y = label.y - layout.height / 2;
    }
    const width = Number.isFinite(label.maxWidth)
      ? label.width
      : layout.width + element.fontSize;
    const screen = toScreen(c.state.viewport, label.x, y);
    const box = elementBox(element);
    const centre = toScreen(
      c.state.viewport,
      box.x + box.width / 2,
      box.y + box.height / 2,
    );
    Object.assign(style, {
      left: screen.x,
      top: screen.y,
      width: Math.max(8, width * zoom + 2),
      // Half a line to spare: glyphs of some fonts reach below the last line
      // box, and a textarea one pixel too short scrolls its text up.
      height:
        (Math.max(layout.height, element.fontSize * LINE_HEIGHT) +
          element.fontSize / 2) *
          zoom +
        2,
      font: fontCss(element.fontFamily, element.fontSize * zoom),
      lineHeight: String(LINE_HEIGHT),
      textAlign:
        element.type === "arrow" || element.type === "line"
          ? "center"
          : element.textAlign,
      // Same colour the canvas paints, dark theme included.
      color: themeColor(element.strokeColor, c.options.theme),
      transformOrigin: `${centre.x - screen.x}px ${centre.y - screen.y}px`,
      transform: element.angle ? `rotate(${element.angle}rad)` : undefined,
    });
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    event.stopPropagation();
    // Keys that pick or cancel an input method's candidate belong to it.
    if (isComposingKey(event)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      commit();
    } else if (
      event.key === "Enter" &&
      (event.ctrlKey || event.metaKey || isFrame)
    ) {
      event.preventDefault();
      commit();
    } else if (event.key === "Tab") {
      event.preventDefault();
      commit();
    }
  };

  const onChange = (next: string) => {
    setValue(next);
    const base = original.current;
    if (base?.type === "text") {
      // Keep the selection box in step with the text as it grows.
      c.setPreview(
        [
          {
            ...base,
            text: "",
            ...measureTextElement(base, next),
          } as BoardElement,
        ],
        {
          live: false,
        },
      );
    }
  };

  const shared = {
    "aria-label": isFrame
      ? t("whiteboardEditor:text.frameName")
      : t("whiteboardEditor:text.label"),
    className:
      "z-20 m-0 resize-none overflow-hidden whitespace-pre-wrap break-words border-0 bg-transparent p-0 text-[inherit] caret-[var(--primary)] outline-none",
    style,
    spellCheck: true,
    onBlur: () => {
      if (focused.current) commit();
    },
    onKeyDown,
    onPointerDown: (event: React.PointerEvent) => event.stopPropagation(),
    "data-testid": "whiteboard-text-editor",
  };

  if (isFrame) {
    return (
      <input
        {...shared}
        ref={(node) => {
          ref.current = node;
        }}
        value={value}
        maxLength={200}
        onChange={(event) => onChange(event.target.value)}
        className={`${shared.className} rounded-sm bg-background px-1 text-foreground ring-2 ring-ring`}
      />
    );
  }
  return (
    <textarea
      {...shared}
      ref={(node) => {
        ref.current = node;
      }}
      value={value}
      maxLength={20_000}
      rows={1}
      wrap={
        element.type === "text" && "autoSize" in element && element.autoSize
          ? "off"
          : "soft"
      }
      onChange={(event) => onChange(event.target.value)}
      onCompositionEnd={(event) =>
        onChange((event.target as HTMLTextAreaElement).value)
      }
    />
  );
}
