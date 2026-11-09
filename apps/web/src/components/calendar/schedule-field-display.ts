/** The custom field chosen for Calendar and Gantt, as tasks show it. */
export type ScheduleFieldDisplay = {
  name: string;
  /** Each task's value as it reads; tasks without one are absent. */
  values: ReadonlyMap<string, string>;
};

/** "Field: value" for tooltips and accessible names; null without a value. */
export function scheduleFieldText(
  display: ScheduleFieldDisplay | null | undefined,
  taskId: string,
  t: (key: string, options?: Record<string, unknown>) => string,
): string | null {
  const value = display?.values.get(taskId);
  return display && value
    ? t("tasks:scheduleField.value", { name: display.name, value })
    : null;
}
