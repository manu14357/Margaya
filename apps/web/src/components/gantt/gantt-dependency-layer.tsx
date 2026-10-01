import { type JSX, memo, useId } from "react";
import type { DependencyLine } from "./dependency-lines";

type GanttDependencyLayerProps = {
  lines: DependencyLine[];
  /** Left edge of the timeline, as a CSS length (the task list's width). */
  left: string;
  widthRem: number;
};

function ArrowMarker({ id }: { id: string }) {
  return (
    <marker
      id={id}
      viewBox="0 0 6 6"
      refX="5"
      refY="3"
      markerWidth="6"
      markerHeight="6"
      orient="auto-start-reverse"
    >
      <path d="M 0 0 L 6 3 L 0 6 z" fill="currentColor" />
    </marker>
  );
}

/**
 * Connectors between related bars, drawn under the bars. Purely visual: a
 * conflict is also flagged in the task list, which is what screen readers
 * get. Each group sets its colour through `currentColor`, so the arrowheads
 * defined inside it match its lines.
 */
function GanttDependencyLayer({
  lines,
  left,
  widthRem,
}: GanttDependencyLayerProps): JSX.Element | null {
  // Marker ids go inside url(#…), so keep them to plain characters.
  const baseId = `gantt-dep-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  if (lines.length === 0) return null;
  const okArrow = `${baseId}-ok`;
  const conflictArrow = `${baseId}-conflict`;

  return (
    <svg
      aria-hidden="true"
      data-testid="gantt-dependency-lines"
      className="pointer-events-none absolute top-0 z-[5] h-full overflow-visible"
      style={{ left, width: `${widthRem}rem` }}
    >
      <g className="text-muted-foreground">
        <defs>
          <ArrowMarker id={okArrow} />
        </defs>
        {lines
          .filter((line) => !line.conflict)
          .map((line) => (
            <path
              key={line.id}
              d={line.d}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.25}
              strokeLinejoin="round"
              markerEnd={`url(#${okArrow})`}
              data-relation-type={line.type}
            />
          ))}
      </g>
      <g className="text-destructive">
        <defs>
          <ArrowMarker id={conflictArrow} />
        </defs>
        {lines
          .filter((line) => line.conflict)
          .map((line) => (
            <path
              key={line.id}
              d={line.d}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.75}
              strokeLinejoin="round"
              markerEnd={`url(#${conflictArrow})`}
              data-relation-type={line.type}
              data-conflict="true"
            />
          ))}
      </g>
    </svg>
  );
}

export default memo(GanttDependencyLayer);
