import { type RefObject, useLayoutEffect, useRef, useState } from "react";

const EMPTY: ReadonlyMap<string, number> = new Map();

function sameCenters(
  left: ReadonlyMap<string, number>,
  right: ReadonlyMap<string, number>,
) {
  if (left.size !== right.size) return false;
  for (const [id, y] of left) {
    if (right.get(id) !== y) return false;
  }
  return true;
}

/**
 * The vertical middle of every `[data-gantt-row]` inside the container, in
 * the container's coordinates. Rows grow with their content, so they are
 * measured rather than assumed; all reads happen in one pass, and nothing is
 * measured while `enabled` is false (a project without dependencies).
 */
export function useGanttRowCenters(
  containerRef: RefObject<HTMLElement | null>,
  layoutKey: unknown,
  enabled: boolean,
): ReadonlyMap<string, number> {
  const [centers, setCenters] = useState<ReadonlyMap<string, number>>(EMPTY);
  // What the state last got. Callers build `layoutKey` inline, so this effect
  // runs after every render; setting state, even to an equal value, from an
  // effect that runs after every render can feed itself until React gives up
  // ("Maximum update depth exceeded"). Only a real change may set state.
  const latest = useRef<ReadonlyMap<string, number>>(EMPTY);
  const commit = (next: ReadonlyMap<string, number>) => {
    if (sameCenters(latest.current, next)) return;
    latest.current = next;
    setCenters(next);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: layoutKey stands for whatever moves the rows; it re-runs the measurement.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!enabled || !container) {
      commit(EMPTY);
      return;
    }
    const measure = () => {
      const next = new Map<string, number>();
      for (const row of container.querySelectorAll<HTMLElement>(
        "[data-gantt-row]",
      )) {
        const id = row.dataset.ganttRow;
        if (id) next.set(id, row.offsetTop + row.offsetHeight / 2);
      }
      commit(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef, layoutKey, enabled]);

  return centers;
}
