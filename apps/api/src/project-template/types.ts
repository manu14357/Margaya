// A built-in project template: static, reviewed data. Every user-visible
// string is an i18n key resolved in the creator's locale at apply time; every
// reference is a template-local key resolved to an id, slug or name. The
// checker (validate.ts, scripts/check-template.ts) resolves each template in
// all 20 locales and runs the result through the real request schemas and
// validators before it can ship.
//
// Type-only imports: the catalog route and tests import this cheaply.

import type { BoardTemplateId } from "@margaya/whiteboard";
import type { NOTIFY_ROLES } from "../automation-rule/vocabulary";
import type { CreatableColumnGroup } from "../column/groups";
import type { EstimateType } from "../estimate/types";
import type { ModuleStatus } from "../module/types";
import type { ProjectFeature } from "../project/features";
import type { VALID_PRIORITIES } from "../task/validate-task-fields";
import type { DateUnit } from "../task-query/dates";
import type {
  ArchivedFilter,
  GROUP_BY_KEYS,
  ORDER_BY_FIELDS,
  OrderDirection,
} from "../task-query/schema";
import type {
  DisplayPropertyFlag,
  ViewAccess,
  ViewLayout,
} from "../view/types";

// ---------------------------------------------------------------------------
// Basics

/** A static key in the projectTemplates namespace (i18n or a locale fragment). */
export type TextKey = `projectTemplates:${string}`;

/** Stable forever; kebab-case; never reused after retirement. */
export type TemplateId = string;

/** The 17 gallery categories (plans/.../03-templates/categories/*.md). */
export const CATEGORY_IDS = [
  "software-development",
  "service-management",
  "work-management",
  "product-management",
  "marketing",
  "design",
  "it",
  "customer-service",
  "human-resources",
  "finance",
  "legal",
  "sales",
  "operations",
  "facilities",
  "analytics",
  "nonprofit",
  "personal",
] as const;
export type CategoryId = (typeof CATEGORY_IDS)[number];

/** Template-local reference names: [a-z][a-z0-9-]*, unique per kind. */
export type ColumnKey = string;
export type LabelKey = string;
export type FieldKey = string;
export type PageKey = string;
export type ModuleKey = string;
export type SampleTaskKey = string;

export type Priority = (typeof VALID_PRIORITIES)[number];
// "no-priority" | "low" | "medium" | "high" | "urgent"

/** The only person a template may name. Resolved to the caller's user id. */
export type PersonToken = "creator";

/** The web label palette (apps/web/src/constants/label-colors.ts). */
export const LABEL_COLORS = [
  "gray",
  "dark-gray",
  "purple",
  "teal",
  "green",
  "yellow",
  "orange",
  "pink",
  "red",
] as const;
export type LabelColor = (typeof LABEL_COLORS)[number];

// ---------------------------------------------------------------------------
// The template

export type ProjectTemplate = {
  id: TemplateId;
  /** Bump when the applied result changes; copy-only fixes do not bump it. */
  version: number;
  /** First entry is the primary category (gallery placement). */
  categories: readonly [CategoryId, ...CategoryId[]];
  /** Shown in onboarding's short list. */
  featured?: boolean;
  /** A name from apps/web/src/constants/project-icons.ts (POST /project `icon`). */
  icon: string;
  /** Gallery card title; also the default project name. */
  name: TextKey;
  /** One line on the card. */
  pitch: TextKey;
  /** The preview's paragraph. */
  description: TextKey;
  /** Suggested project key (POST /project `slug`): 2-5 of A-Z0-9, editable. */
  suggestedKey: string;
  /** Preselected in the form; the request's `visibility` always wins. */
  suggestedVisibility?: "open" | "restricted";

  project: ProjectSetup;
  /** Board order is array order; the first open column is the entry column. */
  columns: readonly ColumnDef[];
  labels?: readonly LabelDef[];
  customFields?: readonly CustomFieldDef[];
  estimate?: EstimateDef;
  modules?: readonly ModuleDef[];
  taskTemplates?: readonly TaskTemplateDef[];
  views?: readonly ViewDef[];
  automationRules?: readonly AutomationRuleDef[];
  scheduledAutomations?: ScheduledAutomationsDef;
  intakeForm?: IntakeFormDef;
  updateReminder?: UpdateReminderDef;
  pages?: readonly PageDef[];
  pageTemplates?: readonly PageTemplateDef[];
  whiteboards?: readonly WhiteboardDef[];
  /** Written only with `template.sampleData: true` and task:create. */
  sample?: SampleDataDef;
};

// ---------------------------------------------------------------------------
// Project shell (projectTable fields; PATCH /project/{id}/features names)

/**
 * Feature switches by feature name. Omitted = the database default: on for
 * cycles, modules, views, pages, whiteboards, timeTracking, ai; off for
 * intake, estimates, updates. State every flag the template relies on.
 */
export type ProjectFeatureFlags = Partial<Record<ProjectFeature, boolean>>;

export type ProjectSetup = {
  /** project.description (plain text). */
  description?: TextKey;
  /**
   * Every switch, stated explicitly (the checker requires all ten): the
   * gallery shows them, and "routine work must not get heavier" means only
   * what the story needs is on. The checker also enforces pairings (views
   * need views, an intake form needs intake, an estimate needs estimates...).
   */
  features: Record<ProjectFeature, boolean>;
  /** project.leadUserId. */
  lead?: PersonToken;
  /** project.defaultAssigneeUserId (new tasks without assignees get it). */
  defaultAssignee?: PersonToken;
};

// ---------------------------------------------------------------------------
// Workflow (createColumnBody; replaces DEFAULT_PROJECT_COLUMNS)

export type ColumnDef = {
  key: ColumnKey;
  /**
   * Its slug is toSlug(name) in the creator's locale and must be non-empty,
   * unique in the template and not "planned" or "archived", in every locale.
   */
  name: TextKey;
  group: CreatableColumnGroup;
  /** A name from the column icon picker; omitted = the group's icon. */
  icon?: string;
  color?: string;
};

// ---------------------------------------------------------------------------
// Labels (workspace-wide, reused by name)

export type LabelDef = {
  key: LabelKey;
  /** At most 50 characters (automation label names cap). */
  name: TextKey;
  color: LabelColor;
};

// ---------------------------------------------------------------------------
// Custom fields (createCustomFieldBody plus updateCustomFieldBody's caps)

type FieldBase = {
  key: FieldKey;
  /** At most 255 characters; unique in the template. */
  name: TextKey;
  /** A required field must have a default. */
  required?: boolean;
};

export type CustomFieldDef =
  | (FieldBase & { type: "text"; defaultValue?: TextKey })
  | (FieldBase & {
      type: "number";
      /** A finite number as text, e.g. "0"; not translated. */
      defaultValue?: string;
    })
  | (FieldBase & {
      type: "date";
      /** YYYY-MM-DD; rarely useful in a template. */
      defaultValue?: string;
    })
  | (FieldBase & { type: "boolean"; defaultValue?: "true" | "false" })
  | (FieldBase & {
      type: "dropdown";
      /** 1-200 options, each at most 128 characters, unique, in order. */
      options: readonly { key: string; label: TextKey }[];
      /** An option key; resolved to that option's text. */
      defaultOption?: string;
    });

// ---------------------------------------------------------------------------
// Estimates (createEstimateBody; created active; needs estimates on)

export type EstimateDef = {
  /** 1-60 characters. */
  name: TextKey;
  type: EstimateType;
  /**
   * 2-10 distinct values, each at most 20 characters.
   * points: numbers > 0, <= 999, <= 2 decimals, as text ("1", "2", "3"); not translated.
   * time: whole minutes > 0, <= 60000, as text ("30", "60"); not translated.
   * categories: TextKeys translating to non-numeric text ("S", "M", "L" style).
   * Task templates and sample tasks refer to a value by this exact string.
   */
  values: readonly string[];
};

// ---------------------------------------------------------------------------
// Modules (createModuleBody; needs modules on)

export type ModuleDef = {
  key: ModuleKey;
  /** 1-255; unique in the template ignoring case. */
  name: TextKey;
  /** At most 5000. */
  description?: TextKey;
  /** Default "backlog". */
  status?: ModuleStatus;
};

// ---------------------------------------------------------------------------
// Task templates (createTemplateBody; at most 50 per project)

export type TaskTemplateDef = {
  /** 1-80 characters; unique in the template ignoring case. */
  name: TextKey;
  /** At most 200; may contain {title}. Omitted = "{title}"-less empty pattern. */
  titlePattern?: TextKey;
  /** Markdown, at most 100000. */
  description?: TextKey;
  /** Omitted = the project's entry column. */
  column?: ColumnKey;
  priority?: Priority | null;
  /** At most 20. Labels skipped for lack of label:create are dropped. */
  labels?: readonly LabelKey[];
  /** Becomes assigneeIds [creator]; omitted = the project default assignee. */
  assignee?: PersonToken;
  /** A value of `estimate.values`; ignored while estimates are off. */
  estimateValue?: string;
  /** At most 50 sub-task titles, each 1-500 characters. */
  subtasks?: readonly TextKey[];
};

// ---------------------------------------------------------------------------
// Saved views (createViewBody; project views; needs views on)

export type DatePreset =
  | "today"
  | "yesterday"
  | "tomorrow"
  | "thisWeek"
  | "lastWeek"
  | "nextWeek"
  | "thisMonth"
  | "lastMonth"
  | "nextMonth"
  | "past"
  | "future"
  | "none";

export type DateFilterKey =
  | "startDate"
  | "dueDate"
  | "createdAt"
  | "updatedAt"
  | "completedAt";

/** One filter condition, as TaskQueryCondition, with keys for references. */
export type TemplateFilterCondition =
  | {
      key: "status";
      operator: "in" | "notIn";
      /** Resolved to column slugs. */
      columns: readonly ColumnKey[];
    }
  | {
      key: "group";
      operator: "in" | "notIn";
      values: readonly CreatableColumnGroup[];
    }
  | { key: "priority"; operator: "in" | "notIn"; values: readonly Priority[] }
  | {
      key: "assignee" | "createdBy";
      operator: "in" | "notIn";
      /** "me" = whoever opens the view; "none" = no value. */
      values: readonly ("me" | "none")[];
    }
  | {
      key: "label";
      operator: "in" | "notIn";
      /** Resolved to "name:<label name>" values. */
      labels: readonly LabelKey[];
      /** Adds "none" (tasks without labels). */
      includeNone?: boolean;
    }
  | { key: "module"; operator: "in" | "notIn"; modules: readonly ModuleKey[] }
  | {
      key: "cycle";
      operator: "in" | "notIn";
      values: readonly ("current" | "none")[];
    }
  | {
      key: "blocked";
      operator: "in";
      values: readonly ["true"] | readonly ["false"];
    }
  | {
      key: "customField";
      field: FieldKey;
      operator: "in" | "notIn";
      /** Dropdown option keys (resolved to text), "true"/"false", or "none". */
      options: readonly string[];
    }
  | {
      key: DateFilterKey;
      operator: "withinLast" | "withinNext" | "moreThanAgo" | "moreThanAhead";
      /** 1-365. */
      amount: number;
      unit: DateUnit;
    }
  | { key: DateFilterKey; operator: "in"; values: readonly DatePreset[] }
  | { key: DateFilterKey; operator: "empty" | "notEmpty" };
// Absolute dates (on, onOrBefore, onOrAfter, between) are excluded: a
// template cannot know the calendar.

export type TemplateFilterNode =
  | TemplateFilterCondition
  | { op: "and" | "or"; children: readonly TemplateFilterNode[] };
// At most 3 levels, 50 conditions, 20 children per group (MAX_FILTER_*).

export type TemplateGroupBy =
  | (typeof GROUP_BY_KEYS)[number]
  | { customField: FieldKey };

export type TemplateOrderField =
  | (typeof ORDER_BY_FIELDS)[number]
  | { customField: FieldKey };

export type ViewDef = {
  /** 1-255; unique in the template. */
  name: TextKey;
  /** At most 2000. */
  description?: TextKey;
  /** Default "workspace"; "private" belongs to the creator. */
  access?: ViewAccess;
  filters?: {
    root: TemplateFilterNode | null;
    /** Default "exclude". */
    archived?: ArchivedFilter;
  };
  display?: {
    /** Default "list". */
    layout?: ViewLayout;
    /** Default "status". */
    groupBy?: TemplateGroupBy | null;
    /** Needs groupBy and must differ. */
    subGroupBy?: TemplateGroupBy | null;
    /** Default manual. */
    orderBy?: { field: TemplateOrderField; direction?: OrderDirection };
    showSubTasks?: boolean;
    showEmptyGroups?: boolean;
  };
  displayProperties?: Partial<Record<DisplayPropertyFlag, boolean>> & {
    /** Spreadsheet columns, at most 50. */
    customFields?: readonly FieldKey[];
  };
};

// ---------------------------------------------------------------------------
// Automation rules (createAutomationRuleBody; at most 100 per project)

/** May use only {{task.title}}, {{task.key}}, {{task.status}},
 *  {{task.priority}}, {{task.dueDate}}, {{project.name}}, {{rule.name}},
 *  kept verbatim in every locale. */
export type TemplateText = TextKey;

export type TemplateTrigger =
  | { type: "task_created"; fromIntake?: boolean }
  | {
      type: "status_changed";
      from?: readonly ColumnKey[];
      to?: readonly ColumnKey[];
    }
  | { type: "label_added" | "label_removed"; labels?: readonly LabelKey[] }
  | { type: "priority_changed"; to?: readonly Priority[] }
  | { type: "due_date_set" }
  | { type: "due_date_passed" }
  | { type: "comment_added" }
  /** Without people: any assignee. */
  | { type: "assignee_added" | "assignee_removed" }
  | { type: "moved_to_module"; modules?: readonly ModuleKey[] };
// moved_to_cycle is excluded: templates create no lasting cycles.

export type TemplateCondition =
  | { field: "status"; op: "is" | "is_not"; columns: readonly ColumnKey[] }
  | {
      field: "labels";
      op: "contains" | "not_contains";
      labels: readonly LabelKey[];
    }
  | { field: "priority"; op: "is" | "is_not"; values: readonly Priority[] }
  | { field: "assignee"; op: "empty" | "not_empty" }
  | { field: "due_date"; op: "set" | "not_set" }
  | {
      field: "estimate";
      op: "set" | "not_set" | "gte" | "lte";
      /** For gte and lte. */
      value?: number;
    }
  | { field: "title"; op: "contains" | "not_contains"; value: TextKey }
  | {
      field: "custom_field";
      /** Resolved to fieldId. */
      fieldKey: FieldKey;
      op: "equals" | "not_equals";
      /** Dropdown option key, "true"/"false", or a number as text. */
      value: string;
    };

export type TemplateConditionGroup = {
  op: "and" | "or";
  /** 1-20 items; one nested level of groups. */
  conditions: readonly (
    | TemplateCondition
    | { op: "and" | "or"; conditions: readonly TemplateCondition[] }
  )[];
};

export type TemplateAction =
  | { type: "set_status"; column: ColumnKey }
  /** Unassigns everyone. */
  | { type: "unassign" }
  /** The creator only; never a fixed user. */
  | { type: "assign"; person: PersonToken }
  | { type: "add_label" | "remove_label"; label: LabelKey }
  | { type: "set_priority"; priority: Priority }
  /** 0-365 days after the day the rule runs. */
  | { type: "set_due_date"; offsetDays: number }
  /** At most 2000. */
  | { type: "add_comment"; template: TemplateText }
  | { type: "move_to_module"; module: ModuleKey }
  /** At most 200. */
  | { type: "create_subtask"; title: TemplateText }
  | {
      type: "notify";
      /** At least one role. */
      roles: readonly (typeof NOTIFY_ROLES)[number][];
      /** At most 500. */
      message?: TemplateText;
    };
// run_agent and move_to_cycle are excluded; notify.userIds is excluded.

export type AutomationRuleDef = {
  /** 1-120. */
  name: TextKey;
  /** Default true. */
  enabled?: boolean;
  trigger: TemplateTrigger;
  conditions?: TemplateConditionGroup | null;
  /** 1-10. */
  actions: readonly TemplateAction[];
};

// ---------------------------------------------------------------------------
// Scheduled automations (updateProjectAutomationsBody)

export type ScheduledAutomationsDef = {
  /** months 1-12, default 3. */
  autoArchive?: { enabled: boolean; months?: number };
  autoClose?: {
    enabled: boolean;
    /** 1-12, default 3. */
    months?: number;
    /** A column of the template in the "cancelled" group (required when enabled). */
    column?: ColumnKey;
  };
  /** Needs cycles on. */
  cycleRollover?: { enabled: boolean };
  flowAlerts?: { enabled: boolean };
};

// ---------------------------------------------------------------------------
// Intake request form (PUT /intake-form body; needs intake on)

export type FieldMode = "off" | "optional" | "required";

/** Always written with enabled: false; opening it is a project:share action. */
export type IntakeFormDef = {
  /** At most 200. */
  title?: TextKey;
  /** At most 2000. */
  intro?: TextKey;
  /** Default "optional". */
  descriptionField?: FieldMode;
  /** Default "required". */
  emailField?: FieldMode;
  /** Default "optional". */
  nameField?: FieldMode;
  /** Fields of this template, at most 20; they become public once the form is on. */
  customFields?: readonly FieldKey[];
  /** At most 1000. */
  confirmationMessage?: TextKey;
};
// Email intake is never part of a template (instance configuration, secrets).

// ---------------------------------------------------------------------------
// Project update reminder (reminderBody; needs updates on)

export type UpdateReminderDef = {
  enabled: boolean;
  /** 0 Sunday ... 6 Saturday; default 5. */
  weekday?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
};

// ---------------------------------------------------------------------------
// Pages (createPageBody; needs pages on)

export type PageLogo =
  | { kind: "emoji"; value: string }
  /** A project icon catalog name, e.g. "FileText". */
  | { kind: "icon"; value: string };

/**
 * A section of a page: a "## heading" and an optional starter line. The
 * starter is "" (nothing), "-" / "1." / "- [ ]" (an empty list item), or a
 * TextKey (a translated line of markdown).
 */
export type PageSection = {
  heading: TextKey;
  starter?: "" | "-" | "1." | "- [ ]" | TextKey;
};

export type PageDef = {
  key: PageKey;
  /** At most 255. */
  title: TextKey;
  logo?: PageLogo;
  /** Markdown built from translated parts, at most 1 MiB. Keep it short. */
  sections: readonly PageSection[];
  /** Another page of this template; depth at most 5. */
  parent?: PageKey;
  isFullWidth?: boolean;
  // access is always "public" (workspace members with page:read); never published.
};

/** A page template saved in the new project (page_template, projectId set). */
export type PageTemplateDef = {
  /** At most 255. */
  name: TextKey;
  logo?: PageLogo;
  sections: readonly PageSection[];
};
// Skipped (and reported) once the workspace holds PAGE_TEMPLATE_LIMIT (200).

// ---------------------------------------------------------------------------
// Whiteboards (createWhiteboardBody; needs whiteboards on)

export type WhiteboardDef = {
  /** At most 255. */
  title: TextKey;
  /** One emoji. */
  icon?: string;
  /** A board layout from @margaya/whiteboard; its labels come from
   *  whiteboards:templates.labels.* in the same locale. */
  board: BoardTemplateId;
};

// ---------------------------------------------------------------------------
// Sample data (only with template.sampleData and task:create)

export type SampleRecurrence = {
  frequency: "daily" | "weekly" | "monthly" | "yearly";
  /** 1-365, default 1. */
  interval?: number;
  /** Weekly only. */
  weekdays?: readonly (0 | 1 | 2 | 3 | 4 | 5 | 6)[];
  /** Monthly or yearly, 1-31. */
  monthDay?: number;
  /** Default "completion". */
  trigger?: "completion" | "schedule";
};

export type SampleTaskDef = {
  key: SampleTaskKey;
  /** 1-500 characters. */
  title: TextKey;
  /** Markdown. */
  description?: TextKey;
  column: ColumnKey;
  /** Default "no-priority". */
  priority?: Priority;
  labels?: readonly LabelKey[];
  /** Omitted: unassigned (the default assignee does not apply to samples). */
  assignee?: PersonToken;
  /** Days from today in the workspace time zone; start <= due. -365..365. */
  startInDays?: number;
  dueInDays?: number;
  isMilestone?: boolean;
  /** A value of `estimate.values`. */
  estimateValue?: string;
  /** Field key -> option key (dropdown), "true"/"false", a number as text,
   *  YYYY-MM-DD, or a TextKey (text fields). */
  customFields?: Readonly<Record<FieldKey, string>>;
  module?: ModuleKey;
  /** Index into `sample.cycles`. */
  cycle?: number;
  /** Child tasks: become extra sample tasks (same column) with a subtask relation. */
  subtasks?: readonly TextKey[];
  /** task_relation rows among sample tasks (stored types). */
  relations?: readonly {
    type: "blocks" | "related" | "start_before" | "finish_before";
    to: SampleTaskKey;
  }[];
  /** task_recurrence on this task; anchorDate = its due (else start) date, else today. */
  recurrence?: SampleRecurrence;
};

export type SampleDataDef = {
  /** At most 25 tasks including sub-tasks. */
  tasks: readonly SampleTaskDef[];
  /** At most 2, not overlapping, needs cycles on. */
  cycles?: readonly {
    name: TextKey;
    /** Days from today; may be negative for a current cycle. */
    startInDays: number;
    /** 1-60 days. */
    lengthDays: number;
  }[];
};

// ---------------------------------------------------------------------------
// Workspace starters (phase 4)

export type WorkspaceStarter = {
  id: string;
  version: number;
  name: TextKey;
  description: TextKey;
  /** A project icon catalog name. */
  icon: string;
  /** At most 5 projects; keys unique; applied in order in one transaction. */
  projects: readonly {
    templateId: TemplateId;
    /** Project key, 2-5 of A-Z0-9. */
    key: string;
    name?: TextKey;
    visibility?: "open" | "restricted";
  }[];
};

// ---------------------------------------------------------------------------
// The applied result returned by POST /project

export type SkippedKind = "label" | "pageTemplate" | "automationRule";
export type SkipReason = "permission" | "limit" | "deleting";

export type AppliedTemplate = {
  id: TemplateId;
  version: number;
  locale: string;
  sampleTaskCount: number;
  skipped: { kind: SkippedKind; key: string; reason: SkipReason }[];
};
