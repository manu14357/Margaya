import type { LucideIcon } from "lucide-react";
import { type CSSProperties, type ReactNode, useId } from "react";
import { cn } from "@/lib/cn";
import type { ArtAccent, ArtPoint, ArtTone } from "./types";

/*
 * SVG building blocks for the template gallery art. Every drawing is a
 * 320 x 200 canvas: <ArtFrame> paints the well, a skeleton paints one grey
 * "app window", and a few accent shapes plus a badge tell the story.
 * Colours come from styles/template-art.css only; see ART-GUIDE.md.
 */

export const ART_WIDTH = 320;
export const ART_HEIGHT = 200;

/** Text-line widths, so skeleton rows look written rather than identical. */
const LINE_WIDTHS = [0.72, 0.5, 0.64, 0.42, 0.58, 0.36, 0.68, 0.46];

const range = (count: number) => Array.from({ length: count }, (_, i) => i);
const lineWidth = (index: number) => LINE_WIDTHS[index % LINE_WIDTHS.length];

const mixSoft = (color: string) =>
  `color-mix(in srgb, ${color} var(--art-soft-mix), var(--art-surface))`;

/** The CSS colour for a tone. */
export function paint(tone: ArtTone): string {
  switch (tone) {
    case "accent":
      return "var(--art-accent)";
    case "soft":
      return "var(--art-accent-soft)";
    case "ink":
      return "var(--art-ink)";
    case "skeleton":
      return "var(--art-skeleton)";
    case "strong":
      return "var(--art-skeleton-strong)";
    case "surface":
      return "var(--art-surface)";
  }
  const [kind, hue] = tone.split("-");
  const color = `var(--art-accent-${hue})`;
  return kind === "soft" ? mixSoft(color) : color;
}

/** The colour for marks (lines, icons) drawn on top of a shape of `tone`. */
function paintOn(tone: ArtTone): string {
  if (tone === "ink") return "var(--art-ink-fg)";
  if (tone === "accent" || tone.startsWith("accent-"))
    return "var(--art-on-accent)";
  if (tone === "soft") return "var(--art-accent)";
  if (tone.startsWith("soft-")) return `var(--art-accent-${tone.slice(5)})`;
  if (tone === "strong") return "var(--art-surface)";
  return "var(--art-skeleton-strong)";
}

/** The solid version of a tone (`soft-3` becomes `accent-3`). */
function solidOf(tone: ArtTone): ArtTone {
  if (tone === "soft") return "accent";
  if (tone.startsWith("soft-")) return `accent-${tone.slice(5)}` as ArtTone;
  return tone;
}

/** The tinted background that goes with a tone. */
function softOf(tone: ArtTone): string {
  if (tone === "accent" || tone === "soft") return paint("soft");
  if (tone.startsWith("accent-") || tone.startsWith("soft-"))
    return paint(`soft-${tone.slice(tone.indexOf("-") + 1)}` as ArtTone);
  if (tone === "ink") return mixSoft("var(--art-ink)");
  return paint("skeleton");
}

type Box = { x: number; y: number; w: number; h: number };

/* ------------------------------------------------------------------ frame */

type ArtFrameProps = {
  /** The template's accent, `--art-accent-1..8`. Defaults to Canopy green. */
  accent?: ArtAccent;
  /** Only when the art stands alone: makes it a labelled image. */
  label?: string;
  className?: string;
  children: ReactNode;
};

/** The 320 x 200 canvas. Decorative (`aria-hidden`) unless given a label. */
export function ArtFrame({
  accent = 1,
  label,
  className,
  children,
}: ArtFrameProps) {
  const clipId = `art-${useId().replace(/[^\w-]/g, "")}`;
  return (
    <svg
      aria-hidden={label ? undefined : true}
      aria-label={label}
      className={cn("block h-auto w-full", className)}
      data-template-art=""
      fill="none"
      focusable="false"
      role="img"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ "--art-accent": `var(--art-accent-${accent})` } as CSSProperties}
      viewBox={`0 0 ${ART_WIDTH} ${ART_HEIGHT}`}
    >
      <defs>
        <clipPath id={clipId}>
          <rect height={ART_HEIGHT} rx="14" width={ART_WIDTH} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <rect fill="var(--art-bg)" height={ART_HEIGHT} width={ART_WIDTH} />
        {children}
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------- basic shapes */

/** A white "app window". Skeletons draw their own; use it for custom layouts. */
export function Panel({ x, y, w, h, r = 12 }: Box & { r?: number }) {
  return (
    <rect
      fill={paint("surface")}
      height={h}
      rx={r}
      stroke="var(--art-line)"
      strokeWidth="1.5"
      width={w}
      x={x}
      y={y}
    />
  );
}

/** The flat offset shadow under a lifted shape. */
function Lift({ x, y, w, h, r }: Box & { r: number }) {
  return (
    <rect
      fill="var(--art-shadow)"
      height={h}
      rx={r}
      width={w}
      x={x + 1}
      y={y + 4}
    />
  );
}

/** A rounded bar: a timeline bar, a progress fill, a text line. */
export function AccentBar({
  x,
  y,
  w,
  h = 10,
  tone = "accent",
  r,
}: Omit<Box, "h"> & { h?: number; tone?: ArtTone; r?: number }) {
  return (
    <rect
      fill={paint(tone)}
      height={h}
      rx={r ?? Math.min(w, h) / 2}
      width={Math.max(w, 0)}
      x={x}
      y={y}
    />
  );
}

/** A small filled circle: a status, a severity, a "live" marker. */
export function Dot({
  x,
  y,
  r = 4,
  tone = "accent",
}: {
  x: number;
  y: number;
  r?: number;
  tone?: ArtTone;
}) {
  return <circle cx={x} cy={y} fill={paint(tone)} r={r} />;
}

/** A filled circle with a check mark. */
export function Tick({
  x,
  y,
  r = 9,
  tone = "accent",
}: {
  x: number;
  y: number;
  r?: number;
  tone?: ArtTone;
}) {
  return (
    <g>
      <circle
        cx={x}
        cy={y}
        fill={paint(tone)}
        r={r}
        stroke={paint("surface")}
        strokeWidth="2"
      />
      <path
        d={`M${x - r * 0.42} ${y + r * 0.02}L${x - r * 0.1} ${y + r * 0.34}L${x + r * 0.44} ${y - r * 0.3}`}
        stroke={paintOn(tone)}
        strokeWidth={Math.max(2, r * 0.24)}
      />
    </g>
  );
}

/** A person as a soft disc with a head and shoulders. No faces. */
export function Avatar({
  x,
  y,
  r = 10,
  tone = "accent-2",
}: {
  x: number;
  y: number;
  r?: number;
  tone?: ArtTone;
}) {
  const solid = paint(solidOf(tone));
  return (
    <g>
      <circle
        cx={x}
        cy={y}
        fill={softOf(tone)}
        r={r}
        stroke={paint("surface")}
        strokeWidth="2"
      />
      <circle cx={x} cy={y - r * 0.2} fill={solid} r={r * 0.34} />
      <path
        d={`M${x - r * 0.6} ${y + r * 0.74}a${r * 0.6} ${r * 0.52} 0 0 1 ${r * 1.2} 0Z`}
        fill={solid}
      />
    </g>
  );
}

type PillProps = {
  /** Top-left corner. */
  x: number;
  y: number;
  w?: number;
  tone?: ArtTone;
  /** A filled pill (accent background) instead of a soft tint. */
  solid?: boolean;
};

/**
 * A tiny status tag: a dot and a text-like bar. It carries no words on
 * purpose, because visible text would need translating into every locale.
 */
export function Pill({
  x,
  y,
  w = 58,
  tone = "accent",
  solid = false,
}: PillProps) {
  const base = solidOf(tone);
  const background = solid ? paint(base) : softOf(base);
  const mark = solid ? paintOn(base) : paint(base);
  return (
    <g>
      <rect
        fill={background}
        height="18"
        rx="9"
        stroke={paint("surface")}
        strokeWidth="2"
        width={w}
        x={x}
        y={y}
      />
      <circle cx={x + 10} cy={y + 9} fill={mark} r="3.5" />
      <rect
        fill={mark}
        height="5"
        opacity={solid ? 0.85 : 0.6}
        rx="2.5"
        width={Math.max(8, w - 28)}
        x={x + 18}
        y={y + 6.5}
      />
    </g>
  );
}

type AccentCardProps = Partial<Pick<Box, "w" | "h">> &
  Pick<Box, "x" | "y"> & {
    tone?: ArtTone;
    /** Degrees; a few degrees reads as "being dragged". */
    tilt?: number;
    /** Text-like lines on the card, 0 to 3. */
    lines?: number;
    /** A small person disc in the bottom-right corner. */
    avatar?: boolean;
    /** A dashed outline only: an empty slot, a future item. */
    outline?: boolean;
  };

/** A bold, lifted task card in the accent colour. */
export function AccentCard({
  x,
  y,
  w = 84,
  h = 40,
  tone = "accent",
  tilt = 0,
  lines = 2,
  avatar = false,
  outline = false,
}: AccentCardProps) {
  const on = outline ? paint(solidOf(tone)) : paintOn(tone);
  const inner = w - 20;
  return (
    <g
      transform={tilt ? `rotate(${tilt} ${x + w / 2} ${y + h / 2})` : undefined}
    >
      {outline ? (
        <rect
          fill={paint("surface")}
          height={h - 2}
          rx="9"
          stroke={paint(solidOf(tone))}
          strokeDasharray="5 5"
          strokeWidth="2"
          width={w - 2}
          x={x + 1}
          y={y + 1}
        />
      ) : (
        <>
          <Lift h={h} r={9} w={w} x={x} y={y} />
          <rect fill={paint(tone)} height={h} rx="9" width={w} x={x} y={y} />
        </>
      )}
      {range(Math.min(lines, 3)).map((line) => (
        <rect
          fill={on}
          height={line === 0 ? 6 : 5}
          key={line}
          opacity={line === 0 ? 0.95 : 0.65}
          rx="2.5"
          width={inner * (line === 0 ? 0.72 : lineWidth(line + 2) * 0.8)}
          x={x + 10}
          y={y + 10 + line * 11}
        />
      ))}
      {avatar && (
        <circle
          cx={x + w - 14}
          cy={y + h - 13}
          fill={on}
          opacity="0.75"
          r="6"
        />
      )}
    </g>
  );
}

/* --------------------------------------------------------- badge and sparks */

export type SparkSide =
  | "top"
  | "top-right"
  | "right"
  | "bottom-right"
  | "bottom"
  | "bottom-left"
  | "left"
  | "top-left";

const SIDE_ANGLE: Record<SparkSide, number> = {
  right: 0,
  "bottom-right": 45,
  bottom: 90,
  "bottom-left": 135,
  left: 180,
  "top-left": -135,
  top: -90,
  "top-right": -45,
};

type SparksProps = {
  /** The centre of the shape the sparks radiate from (usually a badge). */
  x: number;
  y: number;
  /** That shape's width; sparks start just outside its edge. */
  size?: number;
  side?: SparkSide;
  /** 3 to 5. */
  count?: number;
  tone?: ArtTone;
};

/** Short strokes radiating from a badge: "something happens here". */
export function Sparks({
  x,
  y,
  size = 44,
  side = "top-right",
  count = 3,
  tone = "ink",
}: SparksProps) {
  const total = Math.min(5, Math.max(3, count));
  const step = total === 3 ? 32 : total === 4 ? 26 : 22;
  const half = size / 2;
  return (
    <g stroke={paint(tone)} strokeWidth="3.5">
      {range(total).map((index) => {
        const offset = (index - (total - 1) / 2) * step;
        const radians = ((SIDE_ANGLE[side] + offset) * Math.PI) / 180;
        const cos = Math.cos(radians);
        const sin = Math.sin(radians);
        // Distance from the centre to the square's edge in this direction.
        const edge = half / Math.max(Math.abs(cos), Math.abs(sin));
        const start = edge + 7;
        const length = offset === 0 ? 12 : 9;
        return (
          <line
            key={index}
            x1={x + cos * start}
            x2={x + cos * (start + length)}
            y1={y + sin * start}
            y2={y + sin * (start + length)}
          />
        );
      })}
    </g>
  );
}

type BadgeProps = {
  /** The badge's centre. */
  x: number;
  y: number;
  /** A lucide icon, drawn in the badge. */
  icon: LucideIcon;
  size?: number;
  tone?: ArtTone;
  /** Draws <Sparks> on this side of the badge. */
  sparks?: SparkSide;
  sparkCount?: number;
};

/** The dark rounded square with a pictogram: the template's "subject". */
export function Badge({
  x,
  y,
  icon: Icon,
  size = 44,
  tone = "ink",
  sparks,
  sparkCount = 3,
}: BadgeProps) {
  const left = x - size / 2;
  const top = y - size / 2;
  const iconSize = size * 0.52;
  return (
    <g>
      {sparks && (
        <Sparks
          count={sparkCount}
          side={sparks}
          size={size}
          tone={tone}
          x={x}
          y={y}
        />
      )}
      <Lift h={size} r={size * 0.28} w={size} x={left} y={top} />
      <rect
        fill={paint(tone)}
        height={size}
        rx={size * 0.28}
        width={size}
        x={left}
        y={top}
      />
      <Icon
        aria-hidden="true"
        color={paintOn(tone)}
        height={iconSize}
        strokeWidth={2.25}
        width={iconSize}
        x={x - iconSize / 2}
        y={y - iconSize / 2}
      />
    </g>
  );
}

type FlowArrowProps = {
  from: ArtPoint;
  to: ArtPoint;
  /** Curvature: 0 is straight, positive bows to the left of the travel. */
  bend?: number;
  tone?: ArtTone;
  dashed?: boolean;
};

/** A thin curved arrow showing work moving from one place to another. */
export function FlowArrow({
  from,
  to,
  bend = 0.3,
  tone = "strong",
  dashed = false,
}: FlowArrowProps) {
  const [x1, y1] = from;
  const [x2, y2] = to;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const cx = (x1 + x2) / 2 + dy * bend;
  const cy = (y1 + y2) / 2 - dx * bend;
  const angle = Math.atan2(y2 - cy, x2 - cx);
  const head = (spread: number) =>
    `${x2 - Math.cos(angle + spread) * 9} ${y2 - Math.sin(angle + spread) * 9}`;
  return (
    <g stroke={paint(tone)} strokeWidth="2.5">
      <path
        d={`M${x1} ${y1}Q${cx} ${cy} ${x2} ${y2}`}
        strokeDasharray={dashed ? "5 6" : undefined}
      />
      <path d={`M${head(0.5)}L${x2} ${y2}L${head(-0.5)}`} />
    </g>
  );
}

/* ---------------------------------------------------------------- skeletons */

type Highlight = number | readonly number[];
const marked = (highlight: Highlight | undefined, index: number) =>
  highlight === undefined
    ? false
    : typeof highlight === "number"
      ? highlight === index
      : highlight.includes(index);

const PAD = 12;

type BoardCard = { column: number; card: number };
type BoardProps = Box & {
  columns?: number;
  /** Cards per column; defaults to a gentle 3, 2, 2, 1 rhythm. */
  cards?: readonly number[];
  /** Cards painted in the accent. */
  highlight?: BoardCard | readonly BoardCard[];
};

function Board({ x, y, w, h, columns = 3, cards, highlight }: BoardProps) {
  const gap = 8;
  const top = y + PAD + 16;
  const columnWidth = (w - PAD * 2 - gap * (columns - 1)) / columns;
  const marks = highlight
    ? Array.isArray(highlight)
      ? (highlight as readonly BoardCard[])
      : [highlight as BoardCard]
    : [];
  const rhythm = [3, 2, 2, 1, 2];
  return (
    <g>
      <Panel h={h} w={w} x={x} y={y} />
      <AccentBar
        h={6}
        tone="strong"
        w={Math.min(72, w * 0.3)}
        x={x + PAD}
        y={y + PAD}
      />
      {range(columns).map((column) => {
        const left = x + PAD + column * (columnWidth + gap);
        const count = cards?.[column] ?? rhythm[column % rhythm.length];
        return (
          <g key={column}>
            <rect
              fill="var(--art-bg)"
              height={y + h - PAD - top}
              rx="8"
              width={columnWidth}
              x={left}
              y={top}
            />
            <circle cx={left + 9} cy={top + 9} fill={paint("strong")} r="3" />
            <AccentBar
              h={5}
              tone="strong"
              w={columnWidth * 0.36}
              x={left + 16}
              y={top + 6.5}
            />
            {range(count).map((card) => {
              const isMarked = marks.some(
                (mark) => mark.column === column && mark.card === card,
              );
              const tone: ArtTone = isMarked ? "accent" : "surface";
              const cardY = top + 20 + card * 30;
              const cardWidth = columnWidth - 10;
              return (
                <g key={card}>
                  {isMarked && (
                    <Lift h={24} r={6} w={cardWidth} x={left + 5} y={cardY} />
                  )}
                  <rect
                    fill={paint(tone)}
                    height="24"
                    rx="6"
                    stroke={isMarked ? undefined : "var(--art-line)"}
                    strokeWidth="1.5"
                    width={cardWidth}
                    x={left + 5}
                    y={cardY}
                  />
                  <AccentBar
                    h={5}
                    tone={isMarked ? "surface" : "skeleton"}
                    w={(cardWidth - 16) * lineWidth(column + card)}
                    x={left + 11}
                    y={cardY + 7}
                  />
                  <AccentBar
                    h={4}
                    tone={isMarked ? "surface" : "skeleton"}
                    w={(cardWidth - 16) * 0.3}
                    x={left + 11}
                    y={cardY + 15}
                  />
                </g>
              );
            })}
          </g>
        );
      })}
    </g>
  );
}

type RowsProps = Box & {
  n?: number;
  /** Row index or indexes painted as highlighted. */
  highlight?: Highlight;
  /** A header strip above the rows. */
  header?: boolean;
};

function Rows({ x, y, w, h, n = 4, highlight, header = true }: RowsProps) {
  const rowHeight = 24;
  const inner = w - PAD * 2;
  const start = y + PAD + (header ? 22 : 0);
  return (
    <g>
      <Panel h={h} w={w} x={x} y={y} />
      {header && (
        <g>
          <rect
            fill="var(--art-bg)"
            height="16"
            rx="5"
            width={inner}
            x={x + PAD}
            y={y + PAD}
          />
          <AccentBar
            h={5}
            tone="strong"
            w={inner * 0.22}
            x={x + PAD + 22}
            y={y + PAD + 5.5}
          />
          <AccentBar
            h={5}
            tone="strong"
            w={28}
            x={x + w - PAD - 74}
            y={y + PAD + 5.5}
          />
        </g>
      )}
      {range(n).map((row) => {
        const isMarked = marked(highlight, row);
        const rowY = start + row * rowHeight;
        const mid = rowY + (rowHeight - 4) / 2;
        return (
          <g key={row}>
            {isMarked ? (
              <g>
                <rect
                  fill={paint("soft")}
                  height={rowHeight - 4}
                  rx="6"
                  width={inner}
                  x={x + PAD}
                  y={rowY}
                />
                <rect
                  fill={paint("accent")}
                  height={rowHeight - 4}
                  rx="2"
                  width="4"
                  x={x + PAD}
                  y={rowY}
                />
              </g>
            ) : (
              <line
                stroke="var(--art-line)"
                strokeWidth="1.5"
                x1={x + PAD}
                x2={x + w - PAD}
                y1={rowY + rowHeight - 2}
                y2={rowY + rowHeight - 2}
              />
            )}
            <circle
              cx={x + PAD + 12}
              cy={mid}
              fill={isMarked ? paint("accent") : "none"}
              r="4.5"
              stroke={isMarked ? undefined : paint("strong")}
              strokeWidth="2"
            />
            <AccentBar
              h={6}
              tone={isMarked ? "accent" : "skeleton"}
              w={(inner - 110) * lineWidth(row)}
              x={x + PAD + 24}
              y={mid - 3}
            />
            <AccentBar
              h={10}
              tone={isMarked ? "accent" : "skeleton"}
              w={30}
              x={x + w - PAD - 74}
              y={mid - 5}
            />
            <circle
              cx={x + w - PAD - 16}
              cy={mid}
              fill={isMarked ? paint("accent") : paint("skeleton")}
              opacity={isMarked ? 0.55 : 1}
              r="6"
            />
          </g>
        );
      })}
    </g>
  );
}

type TimelineBar = readonly [start: number, length: number];
type TimelineProps = Box & {
  /** [start, length] as fractions of the track (0 to 1), one per row. */
  bars?: readonly TimelineBar[];
  highlight?: Highlight;
  /** A "today" line at this fraction of the track. */
  today?: number;
  /** Label stubs in a left gutter. */
  labels?: boolean;
};

const DEFAULT_BARS: readonly TimelineBar[] = [
  [0, 0.42],
  [0.22, 0.38],
  [0.46, 0.34],
  [0.12, 0.5],
  [0.6, 0.3],
];

function Timeline({
  x,
  y,
  w,
  h,
  bars = DEFAULT_BARS,
  highlight,
  today,
  labels = true,
}: TimelineProps) {
  const gutter = labels ? 50 : 0;
  const left = x + PAD + gutter;
  const track = w - PAD * 2 - gutter;
  const top = y + PAD + 16;
  const rowHeight = 22;
  return (
    <g>
      <Panel h={h} w={w} x={x} y={y} />
      {range(6).map((tick) => (
        <g key={tick}>
          <line
            stroke="var(--art-line)"
            strokeWidth="1.5"
            x1={left + (track / 6) * tick}
            x2={left + (track / 6) * tick}
            y1={top - 2}
            y2={y + h}
          />
          <AccentBar
            h={4}
            tone="strong"
            w={14}
            x={left + (track / 6) * tick + 4}
            y={y + PAD + 2}
          />
        </g>
      ))}
      {bars.map(([start, length], row) => {
        const rowY = top + 6 + row * rowHeight;
        const isMarked = marked(highlight, row);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed, static list of bars
          <g key={row}>
            {labels && (
              <AccentBar
                h={5}
                tone="strong"
                w={34 * lineWidth(row + 1)}
                x={x + PAD}
                y={rowY + 3.5}
              />
            )}
            {isMarked && (
              <Lift
                h={12}
                r={6}
                w={track * length}
                x={left + track * start}
                y={rowY}
              />
            )}
            <AccentBar
              h={12}
              tone={isMarked ? "accent" : "skeleton"}
              w={track * length}
              x={left + track * start}
              y={rowY}
            />
          </g>
        );
      })}
      {today !== undefined && (
        <g>
          <line
            stroke={paint("accent")}
            strokeWidth="2"
            x1={left + track * today}
            x2={left + track * today}
            y1={top - 4}
            y2={y + h}
          />
          <circle
            cx={left + track * today}
            cy={top - 4}
            fill={paint("accent")}
            r="4"
          />
        </g>
      )}
    </g>
  );
}

type CalendarProps = Box & {
  weeks?: number;
  days?: number;
  /** Cell indexes (row by row) filled with the accent. */
  highlight?: readonly number[];
  /** Cell indexes with a small grey event bar. */
  events?: readonly number[];
};

function Calendar({
  x,
  y,
  w,
  h,
  weeks = 4,
  days = 7,
  highlight = [],
  events = [],
}: CalendarProps) {
  const gap = 4;
  const top = y + PAD + 26;
  const cellWidth = (w - PAD * 2 - gap * (days - 1)) / days;
  const cellHeight = Math.min(
    30,
    (y + h - PAD - top - gap * (weeks - 1)) / weeks,
  );
  return (
    <g>
      <Panel h={h} w={w} x={x} y={y} />
      <AccentBar
        h={6}
        tone="strong"
        w={Math.min(64, w * 0.28)}
        x={x + PAD}
        y={y + PAD}
      />
      {range(days).map((day) => (
        <AccentBar
          h={4}
          key={day}
          tone="skeleton"
          w={Math.min(16, cellWidth * 0.5)}
          x={x + PAD + day * (cellWidth + gap) + 3}
          y={top - 9}
        />
      ))}
      {range(weeks * days).map((cell) => {
        const cellX = x + PAD + (cell % days) * (cellWidth + gap);
        const cellY = top + Math.floor(cell / days) * (cellHeight + gap);
        const isMarked = highlight.includes(cell);
        return (
          <g key={cell}>
            <rect
              fill={isMarked ? paint("accent") : "var(--art-bg)"}
              height={cellHeight}
              rx="5"
              width={cellWidth}
              x={cellX}
              y={cellY}
            />
            {(isMarked || events.includes(cell)) && (
              <AccentBar
                h={4}
                tone={isMarked ? "surface" : "strong"}
                w={cellWidth - 8}
                x={cellX + 4}
                y={cellY + cellHeight - 9}
              />
            )}
          </g>
        );
      })}
    </g>
  );
}

type FormProps = Box & {
  fields?: number;
  /** A submit button below the fields, in this tone; `false` hides it. */
  button?: ArtTone | false;
};

function Form({ x, y, w, h, fields = 3, button = "accent" }: FormProps) {
  const inner = w - PAD * 2 - 4;
  const left = x + PAD + 2;
  const start = y + PAD + 18;
  return (
    <g>
      <Panel h={h} w={w} x={x} y={y} />
      <AccentBar
        h={7}
        tone="strong"
        w={inner * 0.46}
        x={left}
        y={y + PAD + 2}
      />
      {range(fields).map((field) => {
        const fieldY = start + field * 32;
        return (
          <g key={field}>
            <AccentBar
              h={5}
              tone="strong"
              w={inner * lineWidth(field + 3) * 0.6}
              x={left}
              y={fieldY}
            />
            <rect
              fill="var(--art-bg)"
              height="16"
              rx="5"
              stroke="var(--art-line)"
              strokeWidth="1.5"
              width={inner}
              x={left}
              y={fieldY + 9}
            />
          </g>
        );
      })}
      {button && (
        <g>
          <rect
            fill={paint(button)}
            height="18"
            rx="9"
            width="62"
            x={left}
            y={start + fields * 32 + 2}
          />
          <AccentBar
            h={5}
            tone={
              button === "accent" ||
              button.startsWith("accent-") ||
              button === "ink"
                ? "surface"
                : "strong"
            }
            w={34}
            x={left + 14}
            y={start + fields * 32 + 8.5}
          />
        </g>
      )}
    </g>
  );
}

type CardsProps = Box & {
  n?: number;
  cols?: number;
  /** Tile indexes with an accent "image". */
  highlight?: Highlight;
};

function Cards({ x, y, w, h, n = 6, cols = 3, highlight }: CardsProps) {
  const gap = 8;
  const tileWidth = (w - PAD * 2 - gap * (cols - 1)) / cols;
  const tileHeight = 62;
  return (
    <g>
      <Panel h={h} w={w} x={x} y={y} />
      {range(n).map((tile) => {
        const tileX = x + PAD + (tile % cols) * (tileWidth + gap);
        const tileY = y + PAD + Math.floor(tile / cols) * (tileHeight + gap);
        const isMarked = marked(highlight, tile);
        return (
          <g key={tile}>
            <rect
              fill="var(--art-bg)"
              height={tileHeight}
              rx="8"
              width={tileWidth}
              x={tileX}
              y={tileY}
            />
            <rect
              fill={isMarked ? paint("accent") : paint("skeleton")}
              height="30"
              rx="6"
              width={tileWidth - 8}
              x={tileX + 4}
              y={tileY + 4}
            />
            <AccentBar
              h={5}
              tone="strong"
              w={(tileWidth - 16) * lineWidth(tile)}
              x={tileX + 8}
              y={tileY + 41}
            />
            <AccentBar
              h={4}
              tone="skeleton"
              w={(tileWidth - 16) * 0.4}
              x={tileX + 8}
              y={tileY + 51}
            />
          </g>
        );
      })}
    </g>
  );
}

type ChartProps = Box & {
  /** Bar heights (or lengths) as fractions, 0 to 1. */
  values?: readonly number[];
  highlight?: Highlight;
  horizontal?: boolean;
};

function Chart({
  x,
  y,
  w,
  h,
  values = [0.45, 0.7, 0.55, 0.9, 0.65],
  highlight,
  horizontal = false,
}: ChartProps) {
  const left = x + PAD + 4;
  const top = y + PAD + 18;
  const width = w - PAD * 2 - 8;
  const height = Math.min(h, ART_HEIGHT - y) - PAD - 18 - PAD - 4;
  const slot = (horizontal ? height : width) / values.length;
  const thickness = Math.min(slot * 0.62, 28);
  return (
    <g>
      <Panel h={h} w={w} x={x} y={y} />
      <AccentBar
        h={6}
        tone="strong"
        w={Math.min(72, w * 0.3)}
        x={x + PAD}
        y={y + PAD}
      />
      {horizontal ? (
        <line
          stroke={paint("strong")}
          strokeWidth="2"
          x1={left}
          x2={left}
          y1={top}
          y2={top + height}
        />
      ) : (
        <line
          stroke={paint("strong")}
          strokeWidth="2"
          x1={left}
          x2={left + width}
          y1={top + height}
          y2={top + height}
        />
      )}
      {values.map((value, index) => {
        const tone: ArtTone = marked(highlight, index) ? "accent" : "skeleton";
        const along = slot * index + (slot - thickness) / 2;
        return horizontal ? (
          <AccentBar
            h={thickness}
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed, static list of bars
            key={index}
            r={4}
            tone={tone}
            w={(width - 6) * value}
            x={left + 4}
            y={top + along}
          />
        ) : (
          <AccentBar
            h={(height - 6) * value}
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed, static list of bars
            key={index}
            r={4}
            tone={tone}
            w={thickness}
            x={left + along}
            y={top + height - 4 - (height - 6) * value}
          />
        );
      })}
    </g>
  );
}

type DocProps = Box & {
  lines?: number;
  /** Line indexes marked like highlighted text. */
  highlight?: Highlight;
};

function Doc({ x, y, w, h, lines = 6, highlight }: DocProps) {
  const left = x + PAD + 4;
  const inner = w - PAD * 2 - 8;
  return (
    <g>
      <Panel h={h} w={w} x={x} y={y} />
      <AccentBar
        h={8}
        tone="strong"
        w={inner * 0.55}
        x={left}
        y={y + PAD + 4}
      />
      {range(lines).map((line) => {
        const isMarked = marked(highlight, line);
        const lineY = y + PAD + 24 + line * 13;
        return (
          <g key={line}>
            {isMarked && (
              <rect
                fill={paint("soft")}
                height="11"
                rx="3"
                width={inner * lineWidth(line + 6) + 8}
                x={left - 4}
                y={lineY - 3}
              />
            )}
            <AccentBar
              h={5}
              tone={isMarked ? "accent" : "skeleton"}
              w={inner * lineWidth(line + 6)}
              x={left}
              y={lineY}
            />
          </g>
        );
      })}
    </g>
  );
}

/**
 * Grey "app window" skeletons. Each takes the window's box (x, y, w, h);
 * a window may run past the bottom or right edge, the frame crops it.
 */
export const Skeleton = {
  Board,
  Rows,
  Timeline,
  Calendar,
  Form,
  Cards,
  Chart,
  Doc,
};
