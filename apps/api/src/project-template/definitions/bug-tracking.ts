import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/bug-tracking.md

const template: ProjectTemplate = {
  id: "bug-tracking",
  version: 1,
  categories: ["software-development"],
  icon: "Code",
  name: "projectTemplates:catalog.bug-tracking.name",
  pitch: "projectTemplates:catalog.bug-tracking.pitch",
  description: "projectTemplates:catalog.bug-tracking.description",
  suggestedKey: "BUG",

  project: {
    description: "projectTemplates:content.bug-tracking.projectDescription",
    features: {
      cycles: false,
      modules: false,
      views: true,
      pages: true,
      whiteboards: false,
      intake: true,
      estimates: false,
      timeTracking: false,
      ai: false,
      updates: false,
    },
    lead: "creator",
  },

  columns: [
    {
      key: "needs-info",
      name: "projectTemplates:content.bug-tracking.statuses.needsInfo",
      group: "backlog",
    },
    {
      key: "confirmed",
      name: "projectTemplates:common.statuses.confirmed",
      group: "unstarted",
    },
    {
      key: "fixing",
      name: "projectTemplates:content.bug-tracking.statuses.fixing",
      group: "started",
    },
    {
      key: "verifying",
      name: "projectTemplates:content.bug-tracking.statuses.verifying",
      group: "started",
    },
    {
      key: "fixed",
      name: "projectTemplates:content.bug-tracking.statuses.fixed",
      group: "completed",
    },
    {
      key: "closed-without-fix",
      name: "projectTemplates:content.bug-tracking.statuses.closedWithoutFix",
      group: "cancelled",
    },
  ],

  labels: [
    {
      key: "regression",
      name: "projectTemplates:content.bug-tracking.labels.regression",
      color: "red",
    },
    {
      key: "security",
      name: "projectTemplates:common.labels.security",
      color: "pink",
    },
    {
      key: "customer-reported",
      name: "projectTemplates:content.bug-tracking.labels.customerReported",
      color: "yellow",
    },
    {
      key: "cannot-reproduce",
      name: "projectTemplates:content.bug-tracking.labels.cannotReproduce",
      color: "gray",
    },
  ],

  customFields: [
    {
      key: "severity",
      name: "projectTemplates:common.fields.severity",
      type: "dropdown",
      options: [
        {
          key: "critical",
          label:
            "projectTemplates:content.bug-tracking.options.severity.critical",
        },
        {
          key: "major",
          label: "projectTemplates:content.bug-tracking.options.severity.major",
        },
        {
          key: "minor",
          label: "projectTemplates:content.bug-tracking.options.severity.minor",
        },
        {
          key: "trivial",
          label:
            "projectTemplates:content.bug-tracking.options.severity.trivial",
        },
      ],
    },
    {
      key: "environment",
      name: "projectTemplates:content.bug-tracking.fields.environment",
      type: "dropdown",
      options: [
        {
          key: "production",
          label:
            "projectTemplates:content.bug-tracking.options.environment.production",
        },
        {
          key: "staging",
          label:
            "projectTemplates:content.bug-tracking.options.environment.staging",
        },
        {
          key: "development",
          label:
            "projectTemplates:content.bug-tracking.options.environment.development",
        },
      ],
    },
    {
      key: "found-in-version",
      name: "projectTemplates:content.bug-tracking.fields.foundInVersion",
      type: "text",
    },
  ],

  views: [
    {
      name: "projectTemplates:content.bug-tracking.views.openBySeverity",
      description:
        "projectTemplates:content.bug-tracking.views.openBySeverityDescription",
      filters: {
        root: {
          key: "group",
          operator: "notIn",
          values: ["completed", "cancelled"],
        },
      },
      display: {
        layout: "list",
        groupBy: { customField: "severity" },
        orderBy: { field: "priority" },
      },
    },
    {
      name: "projectTemplates:content.bug-tracking.views.regressions",
      filters: {
        root: {
          op: "and",
          children: [
            { key: "label", operator: "in", labels: ["regression"] },
            {
              key: "group",
              operator: "notIn",
              values: ["completed", "cancelled"],
            },
          ],
        },
      },
      display: {
        layout: "list",
        groupBy: null,
        orderBy: { field: "createdAt", direction: "desc" },
      },
    },
    {
      name: "projectTemplates:content.bug-tracking.views.verifyQueue",
      description:
        "projectTemplates:content.bug-tracking.views.verifyQueueDescription",
      filters: {
        root: { key: "status", operator: "in", columns: ["verifying"] },
      },
      display: {
        layout: "list",
        groupBy: null,
        orderBy: { field: "updatedAt", direction: "asc" },
      },
    },
    {
      name: "projectTemplates:content.bug-tracking.views.fixedRecently",
      filters: {
        root: {
          key: "completedAt",
          operator: "withinLast",
          amount: 30,
          unit: "days",
        },
      },
      display: {
        layout: "list",
        groupBy: null,
        orderBy: { field: "completedAt", direction: "desc" },
      },
    },
  ],

  taskTemplates: [
    {
      name: "projectTemplates:content.bug-tracking.taskTemplates.bugReport.name",
      description:
        "projectTemplates:content.bug-tracking.taskTemplates.bugReport.description",
      priority: "medium",
    },
  ],

  automationRules: [
    {
      name: "projectTemplates:content.bug-tracking.rules.criticalPagesLead",
      trigger: { type: "task_created", fromIntake: true },
      conditions: {
        op: "and",
        conditions: [
          {
            field: "custom_field",
            fieldKey: "severity",
            op: "equals",
            value: "critical",
          },
        ],
      },
      actions: [
        { type: "set_priority", priority: "urgent" },
        {
          type: "notify",
          roles: ["lead"],
          message:
            "projectTemplates:content.bug-tracking.rules.criticalMessage",
        },
      ],
    },
    {
      name: "projectTemplates:content.bug-tracking.rules.askForDetails",
      trigger: { type: "status_changed", to: ["needs-info"] },
      actions: [
        {
          type: "add_comment",
          template:
            "projectTemplates:content.bug-tracking.rules.askForDetailsComment",
        },
        {
          type: "notify",
          roles: ["creator"],
          message:
            "projectTemplates:content.bug-tracking.rules.askForDetailsMessage",
        },
      ],
    },
    {
      name: "projectTemplates:content.bug-tracking.rules.securityStaysUrgent",
      trigger: { type: "label_added", labels: ["security"] },
      actions: [
        { type: "set_priority", priority: "urgent" },
        {
          type: "notify",
          roles: ["lead"],
          message:
            "projectTemplates:content.bug-tracking.rules.securityMessage",
        },
      ],
    },
  ],

  scheduledAutomations: {
    autoClose: { enabled: true, months: 1, column: "closed-without-fix" },
  },

  intakeForm: {
    title: "projectTemplates:content.bug-tracking.form.title",
    intro: "projectTemplates:content.bug-tracking.form.intro",
    descriptionField: "required",
    emailField: "required",
    nameField: "optional",
    customFields: ["severity", "environment", "found-in-version"],
    confirmationMessage:
      "projectTemplates:content.bug-tracking.form.confirmation",
  },

  pages: [
    {
      key: "severity-guide",
      title: "projectTemplates:content.bug-tracking.pages.severityGuide.title",
      logo: { kind: "icon", value: "BookOpen" },
      sections: [
        {
          heading:
            "projectTemplates:content.bug-tracking.pages.severityGuide.levels",
          starter:
            "projectTemplates:content.bug-tracking.pages.severityGuide.levelsStarter",
        },
        {
          heading:
            "projectTemplates:content.bug-tracking.pages.severityGuide.severityVsPriority",
          starter:
            "projectTemplates:content.bug-tracking.pages.severityGuide.severityVsPriorityStarter",
        },
        {
          heading:
            "projectTemplates:content.bug-tracking.pages.severityGuide.triage",
          starter:
            "projectTemplates:content.bug-tracking.pages.severityGuide.triageStarter",
        },
        {
          heading:
            "projectTemplates:content.bug-tracking.pages.severityGuide.closing",
          starter:
            "projectTemplates:content.bug-tracking.pages.severityGuide.closingStarter",
        },
      ],
    },
  ],

  sample: {
    tasks: [
      {
        key: "csv-export",
        title: "projectTemplates:content.bug-tracking.samples.csvExport",
        description:
          "projectTemplates:content.bug-tracking.samples.csvExportDescription",
        column: "confirmed",
        priority: "high",
        customFields: {
          severity: "major",
          environment: "production",
          "found-in-version":
            "projectTemplates:content.bug-tracking.samples.version",
        },
      },
      {
        key: "empty-upload",
        title: "projectTemplates:content.bug-tracking.samples.emptyUpload",
        description:
          "projectTemplates:content.bug-tracking.samples.emptyUploadDescription",
        column: "fixing",
        priority: "urgent",
        labels: ["regression"],
        assignee: "creator",
        customFields: { severity: "critical", environment: "production" },
      },
      {
        key: "week-start",
        title: "projectTemplates:content.bug-tracking.samples.weekStart",
        column: "needs-info",
        priority: "low",
        labels: ["customer-reported"],
        customFields: { severity: "minor" },
      },
      {
        key: "session-cookie",
        title: "projectTemplates:content.bug-tracking.samples.sessionCookie",
        column: "verifying",
        priority: "high",
        labels: ["security"],
        customFields: { severity: "major", environment: "staging" },
      },
      {
        key: "tooltip",
        title: "projectTemplates:content.bug-tracking.samples.tooltip",
        column: "fixed",
        priority: "low",
        customFields: { severity: "trivial", environment: "production" },
      },
      {
        key: "archived-search",
        title: "projectTemplates:content.bug-tracking.samples.archivedSearch",
        column: "closed-without-fix",
        priority: "no-priority",
        labels: ["cannot-reproduce"],
        customFields: { severity: "minor" },
      },
    ],
  },
};

export default template;
