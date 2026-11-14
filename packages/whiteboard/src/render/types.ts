// Shared render types. The renderer never depends on DOM type definitions so
// the package compiles and runs in Node; the structural context type below is
// satisfied by a real `CanvasRenderingContext2D`.

/**
 * One path command in element-local units. Canvas and SVG output replay the
 * same list, so both renderers draw identical geometry.
 */
export type PathOp =
  | readonly ["M", x: number, y: number]
  | readonly ["L", x: number, y: number]
  | readonly [
      "C",
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      x: number,
      y: number,
    ]
  | readonly ["Z"];

/** What a task card shows; the caller resolves it from live task data. */
export type TaskCardData = {
  key: string;
  title: string;
  statusName: string;
  statusColor: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  priority: string | null;
  done: boolean;
};

export type RenderTheme = "light" | "dark";

/**
 * Board-to-screen mapping: `screen = (board + scroll) * zoom`, in CSS pixels.
 * `scrollX`/`scrollY` are therefore the negated board coordinates of the
 * viewport's top-left corner.
 */
export type Viewport = {
  scrollX: number;
  scrollY: number;
  zoom: number;
};

/** Returns the advance width of `text` drawn with the CSS `font` shorthand. */
export type MeasureText = (text: string, font: string) => number;

/** Anything a canvas can draw as an image (an `HTMLImageElement`, bitmap...). */
export type CanvasImageLike = object;

/** The part of `Path2D` the renderer uses. */
export type PathLike = {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(
    cp1x: number,
    cp1y: number,
    cp2x: number,
    cp2y: number,
    x: number,
    y: number,
  ): void;
  closePath(): void;
};

export type PathConstructor = new () => PathLike;

/** The subset of `CanvasRenderingContext2D` the renderer calls. */
export type RenderContext = {
  globalAlpha: number;
  /** Optional so minimal contexts work; blending is skipped without it. */
  globalCompositeOperation?: string;
  fillStyle: string | object;
  strokeStyle: string | object;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  font: string;
  textAlign: string;
  textBaseline: string;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  save(): void;
  restore(): void;
  setTransform(
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
  ): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(
    cp1x: number,
    cp1y: number,
    cp2x: number,
    cp2y: number,
    x: number,
    y: number,
  ): void;
  closePath(): void;
  fill(): void;
  fill(path: PathLike): void;
  stroke(): void;
  stroke(path: PathLike): void;
  clip(): void;
  setLineDash(segments: number[]): void;
  fillText(text: string, x: number, y: number): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  clearRect(x: number, y: number, width: number, height: number): void;
  drawImage(
    image: CanvasImageLike,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
  drawImage(
    image: CanvasImageLike,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
};

/** An axis-aligned rectangle in board units. */
export type RenderBox = { x: number; y: number; width: number; height: number };
