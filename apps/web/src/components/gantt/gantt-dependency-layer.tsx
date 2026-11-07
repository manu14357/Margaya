import { type JSX, memo, useId } from "react";
import {
  connectorMidpoint,
  connectorPoints,
  type DependencyLine,
  roundedConnectorPath,
} from "./dependency-lines";

type GanttDependencyLayerProps = {
  lines: DependencyLine[];
  /** Left edge of the timeline, as a CSS length (the task list's width). */
  left: string;
  widthRem: number;
  /** A click on a line. Without it the lines only show. */
  onLineClick?: (line: DependencyLine, x: number, y: number) => void;
};

/**
 * A wider invisible stroke that takes the clicks, as 1.5px is too thin to aim
 * at. It sits under the bars and the task list, so it never takes a press
 * meant for them. The keyboard's way to a link is the task's Relations list.
 */
function LineHitArea({
  line,
  d,
  onLineClick,
}: {
  line: DependencyLine;
  d: string;
  onLineClick: GanttDependencyLayerProps["onLineClick"];
}) {
  if (!onLineClick) return null;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a pointer shortcut; the task's Relations list is the keyboard path.
    <path
      d={d}
      data-gantt-line-hit
      data-testid="gantt-dependency-hit"
      fill="none"
      stroke="transparent"
      strokeWidth={12}
      className="cursor-pointer"
      style={{ pointerEvents: "stroke" }}
      onClick={(event) => onLineClick(line, event.clientX, event.clientY)}
    />
  );
}

function ArrowMarker({ id }: { id: string }) {
  return (
    <marker
      id={id}
      viewBox="0 0 8 8"
      refX="7"
      refY="4"
      markerWidth="7"
      markerHeight="7"
      markerUnits="userSpaceOnUse"
      orient="auto-start-reverse"
    >
      <path
        d="M 0.5 0.5 L 7.5 4 L 0.5 7.5 z"
        fill="currentColor"
        stroke="currentColor"
        strokeLinejoin="round"
      />
    </marker>
  );
}

/**
 * Connectors between related bars, drawn under the bars, with rounded
 * corners and an arrowhead at the dependent's edge. Hidden from screen
 * readers: a conflict is also flagged in the task list, which is what they
 * get; here it is drawn in the conflict colour with a warning dot halfway
 * along. Each group sets its colour through `currentColor`, so the
 * arrowheads defined inside it match its lines.
 */
function GanttDependencyLayer({
  lines,
  left,
  widthRem,
  onLineClick,
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
      className="pointer-events-none absolute top-0 z-0 h-full overflow-visible"
      style={{ left, width: `${widthRem}rem` }}
    >
      <g style={{ color: "var(--dependency)" }}>
        <defs>
          <ArrowMarker id={okArrow} />
        </defs>
        {lines
          .filter((line) => !line.conflict)
          .map((line) => {
            const d = roundedConnectorPath(connectorPoints(line.d));
            return (
              <g key={line.id}>
                <path
                  d={d}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  markerEnd={`url(#${okArrow})`}
                  data-relation-type={line.type}
                />
                <LineHitArea line={line} d={d} onLineClick={onLineClick} />
              </g>
            );
          })}
      </g>
      <g style={{ color: "var(--dependency-conflict)" }}>
        <defs>
          <ArrowMarker id={conflictArrow} />
        </defs>
        {lines
          .filter((line) => line.conflict)
          .map((line) => {
            const points = connectorPoints(line.d);
            const middle = connectorMidpoint(points);
            const d = roundedConnectorPath(points);
            return (
              <g key={line.id}>
                <path
                  d={d}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.75}
                  strokeDasharray="5 3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  markerEnd={`url(#${conflictArrow})`}
                  data-relation-type={line.type}
                  data-conflict="true"
                />
                {middle ? (
                  <g data-conflict-marker="true">
                    <circle
                      cx={middle.x}
                      cy={middle.y}
                      r={6}
                      fill="currentColor"
                      stroke="var(--background)"
                      strokeWidth={1.5}
                    />
                    <path
                      d={`M ${middle.x} ${middle.y - 3} V ${middle.y + 0.5} M ${middle.x} ${middle.y + 2.5} V ${middle.y + 2.6}`}
                      stroke="var(--background)"
                      strokeWidth={1.5}
                      strokeLinecap="round"
                    />
                  </g>
                ) : null}
                <LineHitArea line={line} d={d} onLineClick={onLineClick} />
              </g>
            );
          })}
      </g>
    </svg>
  );
}

export default memo(GanttDependencyLayer);
