import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/customer-support.md

const OPEN = ["unstarted", "started"] as const;

const template: ProjectTemplate = {
  id: "customer-support",
  version: 1,
  categories: ["service-management", "customer-service"],
  icon: "MessageSquare",
  name: "projectTemplates:catalog.customer-support.name",
  pitch: "projectTemplates:catalog.customer-support.pitch",
  description: "projectTemplates:catalog.customer-support.description",
  suggestedKey: "SUP",

  project: {
    description: "projectTemplates:content.customer-support.projectDescription",
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
      key: "ideas",
      name: "projectTemplates:common.statuses.ideas",
      group: "backlog",
    },
    {
      key: "new",
      name: "projectTemplates:common.statuses.new",
      group: "unstarted",
    },
    {
      key: "in-progress",
      name: "projectTemplates:common.statuses.inProgress",
      group: "started",
    },
    {
      key: "waiting-on-customer",
      name: "projectTemplates:content.customer-support.statuses.waitingOnCustomer",
      group: "started",
    },
    {
      key: "with-engineering",
      name: "projectTemplates:content.customer-support.statuses.withEngineering",
      group: "started",
    },
    {
      key: "resolved",
      name: "projectTemplates:common.statuses.resolved",
      group: "completed",
    },
    {
      key: "wont-do",
      name: "projectTemplates:common.statuses.wontDo",
      group: "cancelled",
    },
  ],

  labels: [
    {
      key: "tier-2",
      name: "projectTemplates:content.customer-support.labels.tier2",
      color: "yellow",
    },
    {
      key: "tier-3",
      name: "projectTemplates:content.customer-support.labels.tier3",
      color: "orange",
    },
    {
      key: "key-account",
      name: "projectTemplates:content.customer-support.labels.keyAccount",
      color: "purple",
    },
    {
      key: "known-issue",
      name: "projectTemplates:content.customer-support.labels.knownIssue",
      color: "pink",
    },
  ],

  customFields: [
    {
      key: "kind",
      name: "projectTemplates:content.customer-support.fields.kind",
      type: "dropdown",
      options: [
        { key: "question", label: "projectTemplates:common.options.question" },
        {
          key: "problem",
          label:
            "projectTemplates:content.customer-support.options.kind.problem",
        },
        {
          key: "suggestion",
          label:
            "projectTemplates:content.customer-support.options.kind.suggestion",
        },
        {
          key: "billing",
          label:
            "projectTemplates:content.customer-support.options.kind.billing",
        },
        {
          key: "access",
          label:
            "projectTemplates:content.customer-support.options.kind.access",
        },
      ],
      defaultOption: "question",
    },
    {
      key: "effect",
      name: "projectTemplates:content.customer-support.fields.effect",
      type: "dropdown",
      options: [
        {
          key: "cant-use",
          label:
            "projectTemplates:content.customer-support.options.effect.cantUse",
        },
        {
          key: "partly",
          label:
            "projectTemplates:content.customer-support.options.effect.partly",
        },
        {
          key: "minor",
          label:
            "projectTemplates:content.customer-support.options.effect.minor",
        },
        {
          key: "just-asking",
          label:
            "projectTemplates:content.customer-support.options.effect.justAsking",
        },
      ],
    },
    {
      key: "customer-account",
      name: "projectTemplates:content.customer-support.fields.customerAccount",
      type: "text",
    },
    {
      key: "customers-asking",
      name: "projectTemplates:content.customer-support.fields.customersAsking",
      type: "number",
    },
  ],

  views: [
    {
      name: "projectTemplates:common.views.myQueue",
      filters: {
        root: {
          op: "and",
          children: [
            { key: "assignee", operator: "in", values: ["me"] },
            { key: "group", operator: "in", values: OPEN },
          ],
        },
      },
      display: {
        layout: "list",
        groupBy: "status",
        orderBy: { field: "priority" },
      },
    },
    {
      name: "projectTemplates:common.views.unassigned",
      filters: {
        root: {
          op: "and",
          children: [
            { key: "assignee", operator: "in", values: ["none"] },
            { key: "group", operator: "in", values: OPEN },
          ],
        },
      },
      display: {
        layout: "list",
        groupBy: "status",
        orderBy: { field: "priority" },
      },
    },
    {
      name: "projectTemplates:common.views.breachingSoon",
      description:
        "projectTemplates:content.customer-support.views.breachingSoonDescription",
      filters: {
        root: {
          op: "and",
          children: [
            { key: "group", operator: "in", values: OPEN },
            {
              op: "or",
              children: [
                {
                  key: "dueDate",
                  operator: "withinNext",
                  amount: 1,
                  unit: "days",
                },
                { key: "dueDate", operator: "in", values: ["past"] },
              ],
            },
          ],
        },
      },
      display: {
        layout: "list",
        groupBy: null,
        orderBy: { field: "dueDate", direction: "asc" },
      },
    },
    {
      name: "projectTemplates:content.customer-support.views.topBugsAndIdeas",
      description:
        "projectTemplates:content.customer-support.views.topBugsAndIdeasDescription",
      filters: {
        root: {
          key: "customField",
          field: "kind",
          operator: "in",
          options: ["problem", "suggestion"],
        },
      },
      display: {
        layout: "spreadsheet",
        groupBy: { customField: "kind" },
        orderBy: {
          field: { customField: "customers-asking" },
          direction: "desc",
        },
      },
      displayProperties: {
        customFields: ["customers-asking", "customer-account"],
      },
    },
  ],

  taskTemplates: [
    {
      name: "projectTemplates:content.customer-support.taskTemplates.howTo.name",
      description:
        "projectTemplates:content.customer-support.taskTemplates.howTo.description",
      column: "new",
      priority: "low",
    },
    {
      name: "projectTemplates:content.customer-support.taskTemplates.bugReport.name",
      description:
        "projectTemplates:content.customer-support.taskTemplates.bugReport.description",
      column: "new",
      priority: "medium",
    },
    {
      name: "projectTemplates:content.customer-support.taskTemplates.handToEngineering.name",
      description:
        "projectTemplates:content.customer-support.taskTemplates.handToEngineering.description",
      column: "with-engineering",
      priority: "high",
      labels: ["tier-3"],
    },
    {
      name: "projectTemplates:content.customer-support.taskTemplates.featureSuggestion.name",
      description:
        "projectTemplates:content.customer-support.taskTemplates.featureSuggestion.description",
      column: "ideas",
      priority: "no-priority",
    },
    {
      name: "projectTemplates:content.customer-support.taskTemplates.billingQuestion.name",
      description:
        "projectTemplates:content.customer-support.taskTemplates.billingQuestion.description",
      column: "new",
      priority: "medium",
    },
  ],

  automationRules: [
    {
      name: "projectTemplates:content.customer-support.rules.targetUrgent",
      trigger: { type: "task_created", fromIntake: true },
      conditions: {
        op: "and",
        conditions: [{ field: "priority", op: "is", values: ["urgent"] }],
      },
      actions: [
        { type: "set_due_date", offsetDays: 0 },
        {
          type: "notify",
          roles: ["lead"],
          message:
            "projectTemplates:content.customer-support.rules.urgentMessage",
        },
      ],
    },
    {
      name: "projectTemplates:content.customer-support.rules.targetHigh",
      trigger: { type: "task_created", fromIntake: true },
      conditions: {
        op: "and",
        conditions: [{ field: "priority", op: "is", values: ["high"] }],
      },
      actions: [{ type: "set_due_date", offsetDays: 1 }],
    },
    {
      name: "projectTemplates:content.customer-support.rules.targetMedium",
      trigger: { type: "task_created", fromIntake: true },
      conditions: {
        op: "and",
        conditions: [{ field: "priority", op: "is", values: ["medium"] }],
      },
      actions: [{ type: "set_due_date", offsetDays: 2 }],
    },
    {
      name: "projectTemplates:content.customer-support.rules.targetLow",
      trigger: { type: "task_created", fromIntake: true },
      conditions: {
        op: "and",
        conditions: [{ field: "priority", op: "is", values: ["low"] }],
      },
      actions: [{ type: "set_due_date", offsetDays: 5 }],
    },
    {
      name: "projectTemplates:content.customer-support.rules.lateOwner",
      trigger: { type: "due_date_passed" },
      // Engineering owns the timing of a handed-off bug, and closed requests
      // keep their due date; nobody needs a reminder about either.
      conditions: {
        op: "and",
        conditions: [
          {
            field: "status",
            op: "is_not",
            columns: ["with-engineering", "resolved", "wont-do"],
          },
        ],
      },
      actions: [
        {
          type: "notify",
          roles: ["assignees"],
          message:
            "projectTemplates:content.customer-support.rules.lateMessage",
        },
      ],
    },
  ],

  scheduledAutomations: { autoArchive: { enabled: true, months: 3 } },

  intakeForm: {
    title: "projectTemplates:content.customer-support.form.title",
    intro: "projectTemplates:content.customer-support.form.intro",
    descriptionField: "required",
    emailField: "required",
    nameField: "optional",
    customFields: ["kind", "effect", "customer-account"],
    confirmationMessage:
      "projectTemplates:content.customer-support.form.confirmation",
  },

  pages: [
    {
      key: "reply-guide",
      title: "projectTemplates:content.customer-support.pages.replyGuide.title",
      logo: { kind: "icon", value: "MessageSquare" },
      sections: [
        {
          heading:
            "projectTemplates:content.customer-support.pages.replyGuide.tone",
          starter:
            "projectTemplates:content.customer-support.pages.replyGuide.toneStarter",
        },
        {
          heading:
            "projectTemplates:content.customer-support.pages.replyGuide.greeting",
          starter:
            "projectTemplates:content.customer-support.pages.replyGuide.greetingStarter",
        },
        {
          heading:
            "projectTemplates:content.customer-support.pages.replyGuide.replies",
          starter: "-",
        },
        {
          heading:
            "projectTemplates:content.customer-support.pages.replyGuide.sayingNo",
          starter:
            "projectTemplates:content.customer-support.pages.replyGuide.sayingNoStarter",
        },
      ],
    },
    {
      key: "known-issues",
      title:
        "projectTemplates:content.customer-support.pages.knownIssues.title",
      logo: { kind: "icon", value: "BookOpen" },
      sections: [
        {
          heading:
            "projectTemplates:content.customer-support.pages.knownIssues.howToAdd",
          starter:
            "projectTemplates:content.customer-support.pages.knownIssues.howToAddStarter",
        },
        { heading: "projectTemplates:common.pages.symptoms", starter: "-" },
        {
          heading:
            "projectTemplates:content.customer-support.pages.knownIssues.whoIsAffected",
          starter: "",
        },
        { heading: "projectTemplates:common.pages.workaround", starter: "" },
        {
          heading:
            "projectTemplates:content.customer-support.pages.knownIssues.fixStatus",
          starter:
            "projectTemplates:content.customer-support.pages.knownIssues.fixStatusStarter",
        },
      ],
    },
    {
      key: "escalation-guide",
      title:
        "projectTemplates:content.customer-support.pages.escalationGuide.title",
      logo: { kind: "icon", value: "Layers" },
      sections: [
        {
          heading:
            "projectTemplates:content.customer-support.pages.escalationGuide.firstLine",
          starter:
            "projectTemplates:content.customer-support.pages.escalationGuide.firstLineStarter",
        },
        {
          heading: "projectTemplates:common.pages.whenToEscalate",
          starter:
            "projectTemplates:content.customer-support.pages.escalationGuide.whenStarter",
        },
        {
          heading:
            "projectTemplates:content.customer-support.pages.escalationGuide.handover",
          starter:
            "projectTemplates:content.customer-support.pages.escalationGuide.handoverStarter",
        },
        {
          heading:
            "projectTemplates:content.customer-support.pages.escalationGuide.fixesBack",
          starter:
            "projectTemplates:content.customer-support.pages.escalationGuide.fixesBackStarter",
        },
      ],
    },
    {
      key: "feature-suggestions",
      title:
        "projectTemplates:content.customer-support.pages.featureSuggestions.title",
      logo: { kind: "icon", value: "Lightbulb" },
      sections: [
        {
          heading:
            "projectTemplates:content.customer-support.pages.featureSuggestions.collect",
          starter:
            "projectTemplates:content.customer-support.pages.featureSuggestions.collectStarter",
        },
        {
          heading:
            "projectTemplates:content.customer-support.pages.featureSuggestions.review",
          starter:
            "projectTemplates:content.customer-support.pages.featureSuggestions.reviewStarter",
        },
        {
          heading:
            "projectTemplates:content.customer-support.pages.featureSuggestions.tellCustomers",
          starter:
            "projectTemplates:content.customer-support.pages.featureSuggestions.tellCustomersStarter",
        },
      ],
    },
  ],

  sample: {
    tasks: [
      {
        key: "checkout",
        title: "projectTemplates:content.customer-support.samples.checkout",
        description:
          "projectTemplates:content.customer-support.samples.checkoutDescription",
        column: "with-engineering",
        priority: "high",
        labels: ["tier-3"],
        assignee: "creator",
        startInDays: -1,
        dueInDays: 1,
        customFields: {
          kind: "problem",
          effect: "cant-use",
          "customers-asking": "3",
        },
      },
      {
        key: "export-invoices",
        title:
          "projectTemplates:content.customer-support.samples.exportInvoices",
        description:
          "projectTemplates:content.customer-support.samples.exportInvoicesDescription",
        column: "resolved",
        priority: "low",
        labels: ["known-issue"],
        customFields: { kind: "question", effect: "just-asking" },
      },
      {
        key: "password-reset",
        title:
          "projectTemplates:content.customer-support.samples.passwordReset",
        description:
          "projectTemplates:content.customer-support.samples.passwordResetDescription",
        column: "waiting-on-customer",
        priority: "medium",
        dueInDays: 2,
        customFields: { kind: "access", effect: "partly" },
      },
      {
        key: "charged-twice",
        title: "projectTemplates:content.customer-support.samples.chargedTwice",
        description:
          "projectTemplates:content.customer-support.samples.chargedTwiceDescription",
        column: "in-progress",
        priority: "medium",
        labels: ["key-account"],
        assignee: "creator",
        dueInDays: 2,
        customFields: { kind: "billing", effect: "partly" },
      },
      {
        key: "dark-mode",
        title: "projectTemplates:content.customer-support.samples.darkMode",
        description:
          "projectTemplates:content.customer-support.samples.darkModeDescription",
        column: "ideas",
        priority: "no-priority",
        customFields: { kind: "suggestion", "customers-asking": "7" },
      },
      {
        key: "slow-report",
        title: "projectTemplates:content.customer-support.samples.slowReport",
        description:
          "projectTemplates:content.customer-support.samples.slowReportDescription",
        column: "new",
        priority: "medium",
        labels: ["tier-2"],
        dueInDays: 2,
        customFields: { kind: "problem", effect: "partly" },
      },
    ],
  },
};

export default template;
