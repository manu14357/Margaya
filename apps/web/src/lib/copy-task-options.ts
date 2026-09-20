import type { CopyOption } from "@/fetchers/task-copy/copy-task";

// "Make a copy" options, in the dialog's order. Title, status and priority
// are always copied and are not options.

export const COPY_OPTIONS = [
  "description",
  "assignees",
  "labels",
  "dates",
  "customFields",
  "parent",
  "planning",
  "links",
  "attachments",
] as const satisfies readonly CopyOption[];

export type CopyOptionKey = (typeof COPY_OPTIONS)[number];

/** Checked when the dialog opens; files and links are opt-in. */
export const DEFAULT_COPY_CHOICES: Record<CopyOptionKey, boolean> = {
  description: true,
  assignees: true,
  labels: true,
  dates: true,
  customFields: true,
  parent: true,
  planning: true,
  links: false,
  attachments: false,
};

export const COPY_OPTION_LABEL_KEYS: Record<CopyOptionKey, string> = {
  description: "tasks:copy.options.description",
  assignees: "tasks:copy.options.assignees",
  labels: "tasks:copy.options.labels",
  dates: "tasks:copy.options.dates",
  customFields: "tasks:copy.options.customFields",
  parent: "tasks:copy.options.parent",
  planning: "tasks:copy.options.planning",
  links: "tasks:copy.options.links",
  attachments: "tasks:copy.options.attachments",
};

/** Options that only apply inside the source's own project. */
const SAME_PROJECT_ONLY = new Set<CopyOptionKey>([
  "customFields",
  "parent",
  "planning",
]);

/** Whether the source has something to copy for each option. */
export type CopySourceData = Record<CopyOptionKey, boolean>;

/** The options the dialog lists: the source has data the target can take. */
export function visibleCopyOptions(
  source: CopySourceData,
  sameProject: boolean,
): CopyOptionKey[] {
  return COPY_OPTIONS.filter(
    (option) =>
      source[option] && (sameProject || !SAME_PROJECT_ONLY.has(option)),
  );
}

/** The request's `include`: listed options that are checked. */
export function copyInclude(
  visible: readonly CopyOptionKey[],
  choices: Record<CopyOptionKey, boolean>,
): CopyOptionKey[] {
  return visible.filter((option) => choices[option]);
}

export function isCopyOption(value: string): value is CopyOptionKey {
  return (COPY_OPTIONS as readonly string[]).includes(value);
}
