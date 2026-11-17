import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/development-requests.md

const template: ProjectTemplate = {
  id: "development-requests",
  version: 1,
  categories: ["software-development", "operations", "service-management"],
  icon: "Code",
  name: "projectTemplates:catalog.development-requests.name",
  pitch: "projectTemplates:catalog.development-requests.pitch",
  description: "projectTemplates:catalog.development-requests.description",
  suggestedKey: "DEV",

  project: {
    description:
      "projectTemplates:content.development-requests.projectDescription",
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
      key: "accepted",
      name: "projectTemplates:content.development-requests.statuses.accepted",
      group: "backlog",
    },
    {
      key: "scheduled",
      name: "projectTemplates:common.statuses.scheduled",
      group: "unstarted",
    },
    {
      key: "in-progress",
      name: "projectTemplates:common.statuses.inProgress",
      group: "started",
    },
    {
      key: "delivered",
      name: "projectTemplates:common.statuses.delivered",
      group: "completed",
    },
    {
      key: "not-doing",
      name: "projectTemplates:content.development-requests.statuses.notDoing",
      group: "cancelled",
    },
  ],

  labels: [
    {
      key: "waiting-on-requester",
      name: "projectTemplates:content.development-requests.labels.waitingOnRequester",
      color: "yellow",
    },
    {
      key: "quick-win",
      name: "projectTemplates:common.labels.quickWin",
      color: "green",
    },
  ],

  customFields: [
    {
      key: "request-type",
      name: "projectTemplates:common.fields.requestType",
      type: "dropdown",
      options: [
        {
          key: "new-feature",
          label:
            "projectTemplates:content.development-requests.options.requestType.newFeature",
        },
        {
          key: "change",
          label:
            "projectTemplates:content.development-requests.options.requestType.change",
        },
        {
          key: "data",
          label:
            "projectTemplates:content.development-requests.options.requestType.data",
        },
        {
          key: "access",
          label:
            "projectTemplates:content.development-requests.options.requestType.access",
        },
        { key: "question", label: "projectTemplates:common.options.question" },
      ],
    },
    {
      key: "requesting-team",
      name: "projectTemplates:content.development-requests.fields.requestingTeam",
      type: "text",
    },
    {
      key: "business-impact",
      name: "projectTemplates:content.development-requests.fields.businessImpact",
      type: "dropdown",
      options: [
        {
          key: "blocks-work",
          label:
            "projectTemplates:content.development-requests.options.businessImpact.blocksWork",
        },
        {
          key: "slows-work",
          label:
            "projectTemplates:content.development-requests.options.businessImpact.slowsWork",
        },
        {
          key: "nice-to-have",
          label:
            "projectTemplates:content.development-requests.options.businessImpact.niceToHave",
        },
      ],
    },
    {
      key: "needed-by",
      name: "projectTemplates:common.fields.neededBy",
      type: "date",
    },
  ],

  views: [
    {
      name: "projectTemplates:content.development-requests.views.requestOverview",
      description:
        "projectTemplates:content.development-requests.views.requestOverviewDescription",
      filters: {
        root: {
          key: "group",
          operator: "notIn",
          values: ["completed", "cancelled"],
        },
      },
      display: {
        layout: "spreadsheet",
        groupBy: { customField: "request-type" },
        orderBy: { field: { customField: "needed-by" }, direction: "asc" },
      },
      displayProperties: {
        customFields: ["requesting-team", "business-impact", "needed-by"],
      },
    },
    {
      name: "projectTemplates:content.development-requests.views.blockingWork",
      filters: {
        root: {
          op: "and",
          children: [
            {
              key: "customField",
              field: "business-impact",
              operator: "in",
              options: ["blocks-work"],
            },
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
        orderBy: { field: "createdAt", direction: "asc" },
      },
    },
    {
      name: "projectTemplates:content.development-requests.views.waitingOnRequester",
      filters: {
        root: {
          key: "label",
          operator: "in",
          labels: ["waiting-on-requester"],
        },
      },
      display: {
        layout: "list",
        groupBy: null,
        orderBy: { field: "updatedAt", direction: "asc" },
      },
    },
    {
      name: "projectTemplates:content.development-requests.views.deliveredThisMonth",
      filters: {
        root: {
          op: "and",
          children: [
            { key: "group", operator: "in", values: ["completed"] },
            { key: "completedAt", operator: "in", values: ["thisMonth"] },
          ],
        },
      },
      display: {
        layout: "list",
        groupBy: null,
        orderBy: { field: "completedAt", direction: "desc" },
      },
    },
  ],

  intakeForm: {
    title: "projectTemplates:content.development-requests.form.title",
    intro: "projectTemplates:content.development-requests.form.intro",
    descriptionField: "required",
    nameField: "required",
    emailField: "required",
    customFields: [
      "request-type",
      "requesting-team",
      "business-impact",
      "needed-by",
    ],
    confirmationMessage:
      "projectTemplates:content.development-requests.form.confirmation",
  },

  taskTemplates: [
    {
      name: "projectTemplates:content.development-requests.taskTemplates.acceptedRequest.name",
      titlePattern:
        "projectTemplates:content.development-requests.taskTemplates.acceptedRequest.titlePattern",
      description:
        "projectTemplates:content.development-requests.taskTemplates.acceptedRequest.description",
      column: "accepted",
      priority: "medium",
    },
  ],

  automationRules: [
    {
      name: "projectTemplates:content.development-requests.rules.blockingNoticed",
      trigger: { type: "task_created", fromIntake: true },
      conditions: {
        op: "and",
        conditions: [
          {
            field: "custom_field",
            fieldKey: "business-impact",
            op: "equals",
            value: "blocks-work",
          },
        ],
      },
      actions: [
        { type: "set_priority", priority: "high" },
        {
          type: "notify",
          roles: ["lead"],
          message:
            "projectTemplates:content.development-requests.rules.blockingMessage",
        },
      ],
    },
    {
      name: "projectTemplates:content.development-requests.rules.tellRequester",
      trigger: { type: "status_changed", to: ["delivered"] },
      actions: [
        {
          type: "notify",
          roles: ["creator"],
          message:
            "projectTemplates:content.development-requests.rules.deliveredMessage",
        },
      ],
    },
    {
      name: "projectTemplates:content.development-requests.rules.waitingReminder",
      trigger: { type: "label_added", labels: ["waiting-on-requester"] },
      actions: [
        {
          type: "notify",
          roles: ["creator"],
          message:
            "projectTemplates:content.development-requests.rules.waitingMessage",
        },
        { type: "set_due_date", offsetDays: 5 },
      ],
    },
  ],

  pages: [
    {
      key: "how-to-ask",
      title:
        "projectTemplates:content.development-requests.pages.howToAsk.title",
      logo: { kind: "icon", value: "BookOpen" },
      sections: [
        {
          heading:
            "projectTemplates:content.development-requests.pages.howToAsk.whatWeTake",
          starter:
            "projectTemplates:content.development-requests.pages.howToAsk.whatWeTakeStarter",
        },
        {
          heading:
            "projectTemplates:content.development-requests.pages.howToAsk.whatWeDont",
          starter:
            "projectTemplates:content.development-requests.pages.howToAsk.whatWeDontStarter",
        },
        {
          heading:
            "projectTemplates:content.development-requests.pages.howToAsk.review",
          starter:
            "projectTemplates:content.development-requests.pages.howToAsk.reviewStarter",
        },
        {
          heading:
            "projectTemplates:content.development-requests.pages.howToAsk.responseTimes",
          starter:
            "projectTemplates:content.development-requests.pages.howToAsk.responseTimesStarter",
        },
        {
          heading:
            "projectTemplates:content.development-requests.pages.howToAsk.statuses",
          starter:
            "projectTemplates:content.development-requests.pages.howToAsk.statusesStarter",
        },
      ],
    },
    {
      key: "triage-checklist",
      title: "projectTemplates:content.development-requests.pages.triage.title",
      logo: { kind: "icon", value: "List" },
      sections: [
        {
          heading:
            "projectTemplates:content.development-requests.pages.triage.complete",
          starter:
            "projectTemplates:content.development-requests.pages.triage.completeStarter",
        },
        {
          heading:
            "projectTemplates:content.development-requests.pages.triage.ours",
          starter:
            "projectTemplates:content.development-requests.pages.triage.oursStarter",
        },
        {
          heading:
            "projectTemplates:content.development-requests.pages.triage.duplicate",
          starter:
            "projectTemplates:content.development-requests.pages.triage.duplicateStarter",
        },
        {
          heading:
            "projectTemplates:content.development-requests.pages.triage.impact",
          starter:
            "projectTemplates:content.development-requests.pages.triage.impactStarter",
        },
        {
          heading:
            "projectTemplates:content.development-requests.pages.triage.decide",
          starter:
            "projectTemplates:content.development-requests.pages.triage.decideStarter",
        },
        {
          heading:
            "projectTemplates:content.development-requests.pages.triage.decline",
          starter:
            "projectTemplates:content.development-requests.pages.triage.declineStarter",
        },
      ],
    },
  ],

  sample: {
    tasks: [
      {
        key: "invoice-export",
        title:
          "projectTemplates:content.development-requests.samples.invoiceExport",
        description:
          "projectTemplates:content.development-requests.samples.invoiceExportDescription",
        column: "scheduled",
        priority: "high",
        assignee: "creator",
        dueInDays: 9,
        customFields: {
          "request-type": "data",
          "requesting-team": "projectTemplates:common.options.finance",
          "business-impact": "blocks-work",
        },
      },
      {
        key: "order-logs",
        title:
          "projectTemplates:content.development-requests.samples.orderLogs",
        column: "accepted",
        priority: "medium",
        customFields: {
          "request-type": "access",
          "requesting-team":
            "projectTemplates:content.development-requests.samples.teamSupport",
          "business-impact": "slows-work",
        },
      },
      {
        key: "plan-name",
        title: "projectTemplates:content.development-requests.samples.planName",
        column: "in-progress",
        priority: "medium",
        assignee: "creator",
        startInDays: -2,
        customFields: {
          "request-type": "change",
          "requesting-team": "projectTemplates:common.options.sales",
          "business-impact": "slows-work",
        },
      },
      {
        key: "signup-numbers",
        title:
          "projectTemplates:content.development-requests.samples.signupNumbers",
        column: "delivered",
        priority: "low",
        labels: ["quick-win"],
        customFields: {
          "request-type": "data",
          "requesting-team": "projectTemplates:common.options.marketing",
          "business-impact": "nice-to-have",
        },
      },
      {
        key: "bulk-import",
        title:
          "projectTemplates:content.development-requests.samples.bulkImport",
        description:
          "projectTemplates:content.development-requests.samples.bulkImportDescription",
        column: "accepted",
        priority: "low",
        labels: ["waiting-on-requester"],
        customFields: {
          "request-type": "question",
          "requesting-team":
            "projectTemplates:content.development-requests.samples.teamCustomerSuccess",
        },
      },
    ],
  },
};

export default template;
