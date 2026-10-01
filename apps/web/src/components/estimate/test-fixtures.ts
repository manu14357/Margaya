import type { EstimateType } from "@/lib/estimate/values";
import type { Estimate } from "@/types/estimate";

/** An estimate system for tests; points get ids `${id}-p1`, `${id}-p2`, … */
export function makeEstimate(
  type: EstimateType,
  values: string[],
  overrides: Partial<Estimate> & { taskCounts?: number[] } = {},
): Estimate {
  const { taskCounts = [], ...rest } = overrides;
  const id = rest.id ?? "estimate-1";
  return {
    id,
    projectId: "project-1",
    name: "Sizes",
    type,
    isActive: true,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    points: values.map((value, index) => ({
      id: `${id}-p${index + 1}`,
      estimateId: id,
      value,
      numericValue: type === "categories" ? null : Number(value),
      position: index + 1,
      taskCount: taskCounts[index] ?? 0,
    })),
    ...rest,
  };
}

/** A translator stand-in: keys come back as-is, points with their unit. */
export function testTranslate(
  key: string,
  options: Record<string, unknown> = {},
): string {
  if (key === "tasks:estimate.pointsValue") return `${options.value} pts`;
  if (key === "tasks:estimate.duration.hours") return `${options.hours}h`;
  if (key === "tasks:estimate.duration.minutes") return `${options.minutes}m`;
  if (key === "tasks:estimate.duration.hoursMinutes") {
    return `${options.hours}h ${options.minutes}m`;
  }
  if (key === "tasks:estimate.duration.hourUnit") return "h";
  if (key === "tasks:estimate.duration.minuteUnit") return "m";
  return key;
}
