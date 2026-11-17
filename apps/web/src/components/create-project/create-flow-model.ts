import type { CreateProjectRequest } from "@/fetchers/project/create-project";
import type {
  ProjectTemplatePreview,
  ProjectTemplateSummary,
} from "@/fetchers/project-template/project-templates";
import generateProjectSlug from "@/lib/generate-project-id";
import {
  BLANK_TEMPLATE_ID,
  isValidProjectKey,
  isValidProjectName,
} from "@/lib/project-template-gallery";
import {
  DEFAULT_PROJECT_FEATURES,
  type FeatureSet,
  featuresOfProject,
  featuresOfTemplate,
  type PROJECT_FEATURES,
  type ProjectFeatureKey,
} from "./project-features";
import type { StepDirection } from "./step-transition";

// The project create flow as data: what is chosen, what the person changed,
// and what the server receives. Defaults come from the chosen source; only
// the values the person changed are kept when the source changes
// (plans/create-flow-and-templates/02-flows/state-machine.md §3.3).

export type CreateSource =
  | { kind: "blank" }
  | { kind: "template"; id: string }
  | { kind: "project"; id: string };

export type Visibility = "open" | "restricted";

export type SetupForm = {
  /** Only meaningful once `nameEdited`; otherwise the source suggests one. */
  name: string;
  nameEdited: boolean;
  key: string;
  keyEdited: boolean;
  icon: string;
  iconEdited: boolean;
  /** null keeps the default (on in onboarding, off elsewhere). */
  sampleData: boolean | null;
  /** Only the switches the person changed. */
  features: FeatureSet;
  visibility: Visibility | null;
  copyTaskTemplates: boolean;
  copyOpenTasks: boolean;
};

export const EMPTY_FORM: SetupForm = {
  name: "",
  nameEdited: false,
  key: "",
  keyEdited: false,
  icon: "Layout",
  iconEdited: false,
  sampleData: null,
  features: {},
  visibility: null,
  copyTaskTemplates: false,
  copyOpenTasks: false,
};

export type FlowStep = "choose" | "setup";

export type FlowState = {
  step: FlowStep;
  direction: StepDirection;
  categoryId: string;
  query: string;
  source: CreateSource;
  /** Phone only: the pushed template details view. */
  details: boolean;
  form: SetupForm;
  /** After creating, open the importer (the gallery's Import link). */
  afterCreate: "import" | null;
  /** Arrived by Enter on a tile: focus the name, selected, for typing. */
  focusName: boolean;
};

export type FlowAction =
  | { type: "category"; categoryId: string }
  | { type: "query"; query: string }
  | { type: "select"; source: CreateSource }
  | { type: "continue"; source?: CreateSource; viaKeyboard?: boolean }
  | { type: "back" }
  | { type: "details"; open: boolean }
  | { type: "edit"; change: Partial<SetupForm> }
  | { type: "feature"; key: ProjectFeatureKey; value: boolean }
  | { type: "import" }
  | { type: "restore"; state: FlowState };

export function initialFlowState(
  overrides: Partial<FlowState> = {},
): FlowState {
  return {
    step: "choose",
    direction: "forward",
    categoryId: "recommended",
    query: "",
    source: { kind: "blank" },
    details: false,
    form: EMPTY_FORM,
    afterCreate: null,
    focusName: false,
    ...overrides,
  };
}

export function sameSource(a: CreateSource, b: CreateSource): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "blank" || b.kind === "blank") return true;
  return a.id === b.id;
}

/** A new source keeps what the person typed, unless it cannot apply. */
function formForSource(form: SetupForm, source: CreateSource): SetupForm {
  if (source.kind === "template") {
    return { ...form, copyOpenTasks: false, copyTaskTemplates: false };
  }
  return { ...form, sampleData: null };
}

export function flowReducer(state: FlowState, action: FlowAction): FlowState {
  switch (action.type) {
    case "category":
      return { ...state, categoryId: action.categoryId, query: "" };
    case "query":
      return { ...state, query: action.query };
    case "select":
      return {
        ...state,
        source: action.source,
        form: formForSource(state.form, action.source),
        details: state.details,
      };
    case "continue": {
      const source = action.source ?? state.source;
      return {
        ...state,
        source,
        form: formForSource(state.form, source),
        step: "setup",
        direction: "forward",
        details: false,
        focusName: Boolean(action.viaKeyboard),
      };
    }
    case "back":
      return { ...state, step: "choose", direction: "back", focusName: false };
    case "details":
      return { ...state, details: action.open };
    case "edit":
      return { ...state, form: { ...state.form, ...action.change } };
    case "feature":
      return {
        ...state,
        form: {
          ...state.form,
          features: { ...state.form.features, [action.key]: action.value },
        },
      };
    case "import":
      return {
        ...state,
        source: { kind: "blank" },
        form: formForSource(state.form, { kind: "blank" }),
        afterCreate: "import",
        step: "setup",
        direction: "forward",
        details: false,
      };
    case "restore":
      return { ...action.state, direction: "forward", details: false };
  }
}

/** What the chosen source suggests before the person changes anything. */
export type Suggestion = {
  name: string;
  key: string;
  icon: string;
  features: Record<ProjectFeatureKey, boolean>;
  visibility: Visibility;
  sampleTaskCount: number;
  hasLabels: boolean;
  /** The blank template id when the catalog has one. */
  templateId: string | null;
};

type SourceProject = {
  id: string;
  name: string;
  icon: string | null;
} & Partial<Record<(typeof PROJECT_FEATURES)[number]["field"], boolean>>;

export function suggestionFor({
  source,
  templates,
  preview,
  projects,
}: {
  source: CreateSource;
  templates: readonly ProjectTemplateSummary[];
  preview?: ProjectTemplatePreview | null;
  projects: readonly SourceProject[];
}): Suggestion {
  if (source.kind === "project") {
    const project = projects.find((item) => item.id === source.id);
    return {
      name: "",
      key: "",
      icon: project?.icon ?? "Layout",
      features: project
        ? featuresOfProject(project)
        : { ...DEFAULT_PROJECT_FEATURES },
      visibility: "open",
      sampleTaskCount: 0,
      hasLabels: false,
      templateId: null,
    };
  }
  const templateId =
    source.kind === "template"
      ? source.id
      : templates.some((template) => template.id === BLANK_TEMPLATE_ID)
        ? BLANK_TEMPLATE_ID
        : null;
  const summary = templateId
    ? templates.find((template) => template.id === templateId)
    : undefined;
  if (!summary) {
    return {
      name: "",
      key: "",
      icon: "Layout",
      features: { ...DEFAULT_PROJECT_FEATURES },
      visibility: "open",
      sampleTaskCount: 0,
      hasLabels: false,
      templateId: null,
    };
  }
  const isBlank = summary.id === BLANK_TEMPLATE_ID;
  const usablePreview = preview && preview.id === summary.id ? preview : null;
  return {
    // Blank asks for a name instead of suggesting "Blank project".
    name: isBlank ? "" : summary.name,
    key: isBlank ? "" : summary.suggestedKey,
    icon: summary.icon,
    features: usablePreview
      ? featuresOfTemplate(usablePreview.features)
      : { ...DEFAULT_PROJECT_FEATURES },
    visibility: summary.suggestedVisibility,
    sampleTaskCount: summary.counts.sampleTasks,
    hasLabels: summary.counts.labels > 0,
    templateId: summary.id,
  };
}

/** The values the form shows: what the person changed, else the suggestion. */
export function effectiveForm(form: SetupForm, suggestion: Suggestion) {
  const name = form.nameEdited ? form.name : suggestion.name;
  const key = form.keyEdited
    ? form.key
    : form.nameEdited
      ? generateProjectSlug(form.name).slice(0, 8)
      : suggestion.key || generateProjectSlug(name).slice(0, 8);
  const features = { ...suggestion.features, ...form.features } as Record<
    ProjectFeatureKey,
    boolean
  >;
  return {
    name,
    key: key.toUpperCase(),
    icon: form.iconEdited ? form.icon : suggestion.icon,
    features,
    visibility: form.visibility ?? suggestion.visibility,
  };
}

export type SetupErrors = { name?: "required" | "tooLong"; key?: "invalid" };

export function validateSetup(name: string, key: string): SetupErrors {
  const errors: SetupErrors = {};
  if (!isValidProjectName(name)) {
    errors.name = name.trim() ? "tooLong" : "required";
  }
  if (!isValidProjectKey(key)) errors.key = "invalid";
  return errors;
}

/** The one atomic POST /project for the chosen source and settings. */
export function buildCreateRequest({
  workspaceId,
  source,
  form,
  suggestion,
  sampleData,
  locale,
  canCopyOpenTasks,
}: {
  workspaceId: string;
  source: CreateSource;
  form: SetupForm;
  suggestion: Suggestion;
  sampleData: boolean;
  locale: string;
  canCopyOpenTasks: boolean;
}): CreateProjectRequest {
  const values = effectiveForm(form, suggestion);
  // Only the switches the person changed; the rest keep the source's.
  const features = Object.fromEntries(
    Object.entries(form.features).filter(
      ([key, value]) =>
        typeof value === "boolean" &&
        value !== suggestion.features[key as ProjectFeatureKey],
    ),
  );
  const base = {
    name: values.name.trim(),
    slug: values.key.trim().toUpperCase(),
    icon: values.icon,
    workspaceId,
    visibility: values.visibility,
    ...(Object.keys(features).length > 0 ? { features } : {}),
  };
  if (source.kind === "project") {
    return {
      ...base,
      fromProjectId: source.id,
      copy: {
        taskTemplates: form.copyTaskTemplates,
        openTasks: canCopyOpenTasks && form.copyOpenTasks,
      },
    };
  }
  if (suggestion.templateId) {
    return {
      ...base,
      template: {
        id: suggestion.templateId,
        locale,
        ...(sampleData && suggestion.sampleTaskCount > 0
          ? { sampleData: true }
          : {}),
      },
    };
  }
  return base;
}
