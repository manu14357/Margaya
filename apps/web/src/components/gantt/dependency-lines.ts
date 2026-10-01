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
 * Whether the dates break the relation. A blocker that ends after its
 * dependent starts is a conflict; ending on the day it starts is not. The
 * ordering relations conflict when the source's edge falls after the
 * target's.
 */
export function isDependencyConflict(
  type: DependencyType,
  source: BarSpan,
  target: BarSpan,
): boolean {
  const { from, to } = dependencyEdges(type);
  const sourceDay =
    from === "start" ? source.scheduleStart : source.scheduleEnd;
  const targetDay = to === "start" ? target.scheduleStart : target.scheduleEnd;
  return differenceInCalendarDays(sourceDay, targetDay) > 0;
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
