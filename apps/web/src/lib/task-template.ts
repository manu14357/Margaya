import type {
  CreateTaskTemplateInput,
  TaskTemplate,
  UpdateTaskTemplateInput,
} from "@/types/task-template";

// Pure helpers for task templates: the title pattern (the same rule the API
// applies), the settings form and filling the create-task form.

export const TITLE_PLACEHOLDER = "{title}";

/** `{title}` takes the typed title; otherwise it follows the pattern. */
export function applyTitlePattern(pattern: string, typed = ""): string {
  const title = typed.trim();
  if (pattern.includes(TITLE_PLACEHOLDER)) {
    return pattern
      .replaceAll(TITLE_PLACEHOLDER, title)
      .replace(/\s+/g, " ")
      .trim();
  }
  return [pattern.trim(), title].filter(Boolean).join(" ");
}

/** True when the template can make a title even with nothing typed. */
export function patternMakesTitle(pattern: string): boolean {
  return applyTitlePattern(pattern, "") !== "";
}

export type TemplateFormValues = {
  name: string;
  titlePattern: string;
  description: string;
  columnId: string | null;
  priority: string | null;
  labelIds: string[];
  assigneeIds: string[];
  estimatePointId: string | null;
  subtasks: string[];
};

export const EMPTY_TEMPLATE_FORM: TemplateFormValues = {
  name: "",
  titlePattern: "",
  description: "",
  columnId: null,
  priority: null,
  labelIds: [],
  assigneeIds: [],
  estimatePointId: null,
  subtasks: [],
};

export function templateToForm(template: TaskTemplate): TemplateFormValues {
  return {
    name: template.name,
    titlePattern: template.titlePattern,
    description: template.description,
    columnId: template.columnId,
    priority: template.priority,
    labelIds: template.labels.map((label) => label.id),
    assigneeIds: [...template.assigneeIds],
    estimatePointId: template.estimatePointId,
    subtasks: [...template.subtasks],
  };
}

type TemplatePriority = NonNullable<CreateTaskTemplateInput["priority"]>;

const PRIORITIES: readonly TemplatePriority[] = [
  "no-priority",
  "low",
  "medium",
  "high",
  "urgent",
];

function asPriority(value: string | null): TemplatePriority | null {
  return PRIORITIES.find((priority) => priority === value) ?? null;
}

/** The form as a request body: trimmed, with blank sub-tasks left out. */
export function formToTemplateBody(
  form: TemplateFormValues,
): Required<UpdateTaskTemplateInput> {
  return {
    name: form.name.trim(),
    titlePattern: form.titlePattern.trim(),
    description: form.description,
    columnId: form.columnId,
    priority: asPriority(form.priority),
    labelIds: [...new Set(form.labelIds)],
    assigneeIds: [...new Set(form.assigneeIds)],
    estimatePointId: form.estimatePointId,
    subtasks: form.subtasks.map((title) => title.trim()).filter(Boolean),
  };
}

/** Moves the item at `index` one place up (-1) or down (+1). */
export function moveItem<T>(items: readonly T[], index: number, by: -1 | 1) {
  const target = index + by;
  if (index < 0 || index >= items.length) return [...items];
  if (target < 0 || target >= items.length) return [...items];
  const next = [...items];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item as T);
  return next;
}

/** What the create-task form holds that a template can fill. */
export type TemplateTargetForm = {
  title: string;
  description: string;
  priority: string;
  assigneeIds: string[];
  labels: ReadonlyArray<{ name: string; color: string }>;
};

/** What the last template applied wrote, to replace it on a second pick. */
export type AppliedTemplateTrace = {
  /** The title as it was before the template (what had been typed). */
  baseTitle: string;
  /** The title the template produced. */
  title: string;
  /** The description before the template. */
  baseDescription: string;
  /** The description the template produced. */
  description: string;
};

export type TemplateFormFill = {
  title: string;
  description: string;
  priority: string;
  assigneeIds: string[] | null;
  /** Template labels the form doesn't have yet. */
  addLabels: Array<{ id: string; name: string; color: string }>;
  status: string | null;
  estimatePointId: string | null;
  subtasks: string[];
  trace: AppliedTemplateTrace;
};

/**
 * What picking a template does to the create-task form. The typed title is
 * merged into the pattern; the description is used when there is none yet
 * (else appended); priority, assignees, status and estimate are set only
 * when the template has them; labels are added. A second pick replaces what
 * the first one wrote, as long as it wasn't edited since.
 */
export function fillFormFromTemplate(
  template: Pick<
    TaskTemplate,
    | "titlePattern"
    | "description"
    | "priority"
    | "assigneeIds"
    | "labels"
    | "column"
    | "estimatePointId"
    | "subtasks"
  >,
  form: TemplateTargetForm,
  previous: AppliedTemplateTrace | null = null,
): TemplateFormFill {
  const typedTitle =
    previous && form.title === previous.title ? previous.baseTitle : form.title;
  const title = template.titlePattern
    ? applyTitlePattern(template.titlePattern, typedTitle)
    : typedTitle;

  const baseDescription =
    previous && form.description === previous.description
      ? previous.baseDescription
      : form.description;
  const templateDescription = template.description.trim();
  let description = baseDescription;
  if (templateDescription) {
    description = baseDescription.trim()
      ? `${baseDescription.trimEnd()}\n\n${templateDescription}`
      : templateDescription;
  }

  const present = new Set(form.labels.map((label) => label.name.toLowerCase()));
  const addLabels = template.labels.filter(
    (label) => !present.has(label.name.toLowerCase()),
  );

  return {
    title,
    description,
    priority: template.priority ?? form.priority,
    assigneeIds:
      template.assigneeIds.length > 0 ? [...template.assigneeIds] : null,
    addLabels,
    status: template.column?.slug ?? null,
    estimatePointId: template.estimatePointId,
    subtasks: [...template.subtasks],
    trace: { baseTitle: typedTitle, title, baseDescription, description },
  };
}
