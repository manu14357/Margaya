import { differenceInCalendarDays } from "date-fns";

export type DependencyType = "blocks" | "start_before" | "finish_before";

export type DependencyRelation = {
  id: string;
  sourceTaskId: string;
  targetTaskId: string;
  relationType: DependencyType;
};

type Edge = "start" | "end";

/** A bar's dates: whole local days, both ends included. */
export type BarSpan = { scheduleStart: Date; scheduleEnd: Date };

/** A bar on screen: its left and right edges and the middle of its row. */
export type BarBox = { left: number; right: number; centerY: number };

/**
 * Which edges a relation joins. blocks: the blocker's end to the dependent's
 * start; start_before: start to start; finish_before: end to end.
 */
export function dependencyEdges(type: DependencyType): {
  from: Edge;
  to: Edge;
} {
  switch (type) {
    case "start_before":
      return { from: "start", to: "start" };
    case "finish_before":
      return { from: "end", to: "end" };
    default:
      return { from: "end", to: "start" };
  }
}

/**
 * How many days the target would have to move later for the relation to
 * hold; zero or less when it holds. A blocker that ends after its dependent
 * starts breaks it; ending on the day it starts does not. The ordering
 * relations break when the source's edge falls after the target's.
 */
export function dependencyOverrunDays(
  type: DependencyType,
  source: BarSpan,
  target: BarSpan,
): number {
  const { from, to } = dependencyEdges(type);
  const sourceDay =
    from === "start" ? source.scheduleStart : source.scheduleEnd;
  const targetDay = to === "start" ? target.scheduleStart : target.scheduleEnd;
  return differenceInCalendarDays(sourceDay, targetDay);
}

/** Whether the dates break the relation. */
export function isDependencyConflict(
  type: DependencyType,
  source: BarSpan,
  target: BarSpan,
): boolean {
  return dependencyOverrunDays(type, source, target) > 0;
}

/** Horizontal run, in pixels, before a line turns. */
export const DEPENDENCY_LINE_GAP = 8;

/**
 * An orthogonal connector from one bar edge to another. It leaves an end
 * edge to the right and a start edge to the left, and arrives the same way;
 * when the target edge is behind the source it detours through the gap
 * between the two rows instead of crossing either bar.
 */
export function dependencyPath(
  source: BarBox,
  target: BarBox,
  type: DependencyType,
  gap = DEPENDENCY_LINE_GAP,
): string {
  const { from, to } = dependencyEdges(type);
  const x1 = from === "end" ? source.right : source.left;
  const x2 = to === "end" ? target.right : target.left;
  const y1 = source.centerY;
  const y2 = target.centerY;
  const exitX = from === "end" ? x1 + gap : x1 - gap;
  const entryX = to === "end" ? x2 + gap : x2 - gap;

  if (from === "start" && to === "start") {
    const turnX = Math.min(exitX, entryX);
    return `M ${x1} ${y1} H ${turnX} V ${y2} H ${x2}`;
  }
  if (from === "end" && to === "end") {
    const turnX = Math.max(exitX, entryX);
    return `M ${x1} ${y1} H ${turnX} V ${y2} H ${x2}`;
  }
  if (entryX >= exitX) {
    return `M ${x1} ${y1} H ${exitX} V ${y2} H ${x2}`;
  }
  // The dependent starts before the blocker ends: step down (or up) between
  // the rows, run back, then come in from the left.
  const midY = (y1 + y2) / 2;
  return `M ${x1} ${y1} H ${exitX} V ${midY} H ${entryX} V ${y2} H ${x2}`;
}

export type DependencyLine = {
  id: string;
  type: DependencyType;
  d: string;
  conflict: boolean;
  sourceTaskId: string;
  targetTaskId: string;
};

/**
 * Lines for the relations whose two bars are both on screen. Anything else
 * is skipped, so the work tracks what is visible rather than the project.
 */
export function buildDependencyLines(
  relations: readonly DependencyRelation[],
  bars: ReadonlyMap<string, { span: BarSpan; box: BarBox }>,
): DependencyLine[] {
  const lines: DependencyLine[] = [];
  for (const relation of relations) {
    const source = bars.get(relation.sourceTaskId);
    const target = bars.get(relation.targetTaskId);
    if (!source || !target || relation.sourceTaskId === relation.targetTaskId)
      continue;
    lines.push({
      id: relation.id,
      type: relation.relationType,
      d: dependencyPath(source.box, target.box, relation.relationType),
      conflict: isDependencyConflict(
        relation.relationType,
        source.span,
        target.span,
      ),
      sourceTaskId: relation.sourceTaskId,
      targetTaskId: relation.targetTaskId,
    });
  }
  return lines;
}

/**
 * Where a bar sits horizontally: day columns from the window start, inset by
 * the bar's own margin. Null when the bar is outside the window.
 */
export function barHorizontalBox(
  span: BarSpan,
  rangeStart: Date,
  dayCount: number,
  pixelsPerDay: number,
  inset = 4,
): { left: number; right: number } | null {
  const startIndex = differenceInCalendarDays(span.scheduleStart, rangeStart);
  const endIndex = differenceInCalendarDays(span.scheduleEnd, rangeStart);
  if (endIndex < 0 || startIndex >= dayCount) return null;
  const first = Math.max(0, startIndex);
  const last = Math.min(dayCount - 1, endIndex);
  return {
    left: first * pixelsPerDay + inset,
    right: (last + 1) * pixelsPerDay - inset,
  };
}

/** Half a milestone diamond's width, where a connector meets its point. */
export const MILESTONE_HALF_WIDTH_PX = 10;

/**
 * Where a milestone sits horizontally: a diamond in the middle of its day
 * column, so connectors end at its points rather than the column's edges.
 */
export function milestoneHorizontalBox(
  day: Date,
  rangeStart: Date,
  dayCount: number,
  pixelsPerDay: number,
): { left: number; right: number } | null {
  const index = differenceInCalendarDays(day, rangeStart);
  if (index < 0 || index >= dayCount) return null;
  const middle = (index + 0.5) * pixelsPerDay;
  return {
    left: middle - MILESTONE_HALF_WIDTH_PX,
    right: middle + MILESTONE_HALF_WIDTH_PX,
  };
}

type Point = { x: number; y: number };

/** The corners of a connector built by `dependencyPath` (M, H and V only). */
export function connectorPoints(d: string): Point[] {
  const tokens = d.trim().split(/\s+/);
  const points: Point[] = [];
  let x = 0;
  let y = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const command = tokens[index];
    if (command === "M") {
      x = Number(tokens[++index]);
      y = Number(tokens[++index]);
    } else if (command === "H") {
      x = Number(tokens[++index]);
    } else if (command === "V") {
      y = Number(tokens[++index]);
    } else {
      continue;
    }
    points.push({ x, y });
  }
  return points;
}

/**
 * The same connector with each corner rounded by up to `radius`, never more
 * than half of either neighbouring run, so short steps stay crisp and the
 * last run (where the arrowhead sits) stays straight.
 */
export function roundedConnectorPath(points: readonly Point[], radius = 4) {
  if (points.length === 0) return "";
  const [first] = points;
  let path = `M ${first.x} ${first.y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const corner = points[index];
    const next = points[index + 1];
    const inLength = Math.hypot(corner.x - previous.x, corner.y - previous.y);
    const outLength = Math.hypot(next.x - corner.x, next.y - corner.y);
    const r = Math.min(radius, inLength / 2, outLength / 2);
    if (r <= 0) {
      path += ` L ${corner.x} ${corner.y}`;
      continue;
    }
    const before = {
      x: corner.x - ((corner.x - previous.x) / inLength) * r,
      y: corner.y - ((corner.y - previous.y) / inLength) * r,
    };
    const after = {
      x: corner.x + ((next.x - corner.x) / outLength) * r,
      y: corner.y + ((next.y - corner.y) / outLength) * r,
    };
    path += ` L ${before.x} ${before.y} Q ${corner.x} ${corner.y} ${after.x} ${after.y}`;
  }
  const last = points[points.length - 1];
  if (points.length > 1) path += ` L ${last.x} ${last.y}`;
  return path;
}

/** The point halfway along a connector, where a conflict's marker sits. */
export function connectorMidpoint(points: readonly Point[]): Point | null {
  if (points.length === 0) return null;
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += Math.hypot(
      points[index].x - points[index - 1].x,
      points[index].y - points[index - 1].y,
    );
  }
  let remaining = total / 2;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (length >= remaining && length > 0) {
      const share = remaining / length;
      return {
        x: from.x + (to.x - from.x) * share,
        y: from.y + (to.y - from.y) * share,
      };
    }
    remaining -= length;
  }
  return points[points.length - 1];
}
