import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/product-discovery.md

const template: ProjectTemplate = {
  id: "product-discovery",
  version: 1,
  categories: ["product-management", "software-development"],
  icon: "Lightbulb",
  name: "projectTemplates:catalog.product-discovery.name",
  pitch: "projectTemplates:catalog.product-discovery.pitch",
  description: "projectTemplates:catalog.product-discovery.description",
  suggestedKey: "DISC",

  project: {
    description:
      "projectTemplates:content.product-discovery.projectDescription",
    features: {
      cycles: false,
      modules: false,
      views: true,
      pages: true,
      whiteboards: true,
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
      key: "idea",
      name: "projectTemplates:common.statuses.ideas",
      group: "backlog",
    },
    {
      key: "up-next",
      name: "projectTemplates:common.statuses.upNext",
      group: "unstarted",
    },
    {
      key: "discovering",
      name: "projectTemplates:content.product-discovery.statuses.discovering",
      group: "started",
    },
    {
      key: "building",
      name: "projectTemplates:content.product-discovery.statuses.building",
      group: "started",
    },
    {
      key: "shipped",
      name: "projectTemplates:content.product-discovery.statuses.shipped",
      group: "completed",
    },
    {
      key: "parked",
      name: "projectTemplates:common.statuses.parked",
      group: "cancelled",
    },
  ],

  labels: [
    {
      key: "customer-request",
      name: "projectTemplates:content.product-discovery.labels.customerRequest",
      color: "yellow",
    },
    {
      key: "experiment",
      name: "projectTemplates:content.product-discovery.labels.experiment",
      color: "purple",
    },
  ],

  customFields: [
    {
      key: "evidence",
      name: "projectTemplates:content.product-discovery.fields.evidence",
      type: "dropdown",
      options: [
        {
          key: "none-yet",
          label:
            "projectTemplates:content.product-discovery.options.evidence.noneYet",
        },
        {
          key: "problem-confirmed",
          label:
            "projectTemplates:content.product-discovery.options.evidence.problemConfirmed",
        },
        {
          key: "solution-tested",
          label:
            "projectTemplates:content.product-discovery.options.evidence.solutionTested",
        },
      ],
      defaultOption: "none-yet",
    },
    {
      key: "source",
      name: "projectTemplates:common.fields.source",
      type: "dropdown",
      options: [
        {
          key: "customer",
          label:
            "projectTemplates:content.product-discovery.options.source.customer",
        },
        {
          key: "support",
          label:
            "projectTemplates:content.product-discovery.options.source.support",
        },
        { key: "sales", label: "projectTemplates:common.options.sales" },
        {
          key: "team",
          label:
            "projectTemplates:content.product-discovery.options.source.team",
        },
        {
          key: "data",
          label:
            "projectTemplates:content.product-discovery.options.source.data",
        },
      ],
    },
    {
      key: "target-outcome",
      name: "projectTemplates:content.product-discovery.fields.targetOutcome",
      type: "text",
    },
  ],

  views: [
    {
      name: "projectTemplates:content.product-discovery.views.discoveryBoard",
      filters: {
        root: { key: "group", operator: "notIn", values: ["cancelled"] },
      },
      display: { layout: "board", groupBy: "status" },
    },
    {
      name: "projectTemplates:content.product-discovery.views.ideaInbox",
      filters: { root: { key: "status", operator: "in", columns: ["idea"] } },
      display: {
        layout: "list",
        groupBy: null,
        orderBy: { field: "createdAt", direction: "desc" },
      },
    },
    {
      name: "projectTemplates:content.product-discovery.views.byEvidence",
      filters: {
        root: {
          key: "status",
          operator: "in",
          columns: ["up-next", "discovering"],
        },
      },
      display: { layout: "list", groupBy: { customField: "evidence" } },
      displayProperties: { customFields: ["evidence", "target-outcome"] },
    },
    {
      name: "projectTemplates:content.product-discovery.views.bySource",
      filters: { root: null },
      display: {
        layout: "list",
        groupBy: { customField: "source" },
        orderBy: { field: "createdAt", direction: "desc" },
      },
    },
  ],

  intakeForm: {
    title: "projectTemplates:content.product-discovery.form.title",
    intro: "projectTemplates:content.product-discovery.form.intro",
    descriptionField: "required",
    nameField: "optional",
    emailField: "optional",
    customFields: ["source"],
    confirmationMessage:
      "projectTemplates:content.product-discovery.form.confirmation",
  },

  taskTemplates: [
    {
      name: "projectTemplates:content.product-discovery.taskTemplates.idea.name",
      description:
        "projectTemplates:content.product-discovery.taskTemplates.idea.description",
      column: "idea",
      priority: "no-priority",
    },
    {
      name: "projectTemplates:content.product-discovery.taskTemplates.assumptionTest.name",
      titlePattern:
        "projectTemplates:content.product-discovery.taskTemplates.assumptionTest.titlePattern",
      description:
        "projectTemplates:content.product-discovery.taskTemplates.assumptionTest.description",
      priority: "medium",
      labels: ["experiment"],
      subtasks: [
        "projectTemplates:content.product-discovery.subtasks.planTest",
        "projectTemplates:content.product-discovery.subtasks.runTest",
        "projectTemplates:content.product-discovery.subtasks.writeUpResult",
      ],
    },
  ],

  automationRules: [
    {
      name: "projectTemplates:content.product-discovery.rules.buildOnEvidence",
      trigger: { type: "status_changed", to: ["building"] },
      conditions: {
        op: "and",
        conditions: [
          {
            field: "custom_field",
            fieldKey: "evidence",
            op: "equals",
            value: "none-yet",
          },
        ],
      },
      actions: [
        {
          type: "add_comment",
          template:
            "projectTemplates:content.product-discovery.rules.buildOnEvidenceComment",
        },
        {
          type: "notify",
          roles: ["lead"],
          message:
            "projectTemplates:content.product-discovery.rules.buildOnEvidenceMessage",
        },
      ],
    },
    {
      name: "projectTemplates:content.product-discovery.rules.checkOutcome",
      trigger: { type: "status_changed", to: ["shipped"] },
      actions: [
        {
          type: "create_subtask",
          title:
            "projectTemplates:content.product-discovery.rules.checkOutcomeSubtask",
        },
      ],
    },
  ],

  pages: [
    {
      key: "discovery-brief",
      title: "projectTemplates:content.product-discovery.pages.brief.title",
      logo: { kind: "icon", value: "Lightbulb" },
      sections: [
        {
          heading:
            "projectTemplates:content.product-discovery.pages.brief.problem",
          starter:
            "projectTemplates:content.product-discovery.pages.brief.problemStarter",
        },
        { heading: "projectTemplates:common.pages.audience", starter: "-" },
        {
          heading:
            "projectTemplates:content.product-discovery.pages.brief.evidence",
          starter:
            "projectTemplates:content.product-discovery.pages.brief.evidenceStarter",
        },
        {
          heading:
            "projectTemplates:content.product-discovery.pages.brief.options",
          starter: "1.",
        },
        {
          heading:
            "projectTemplates:content.product-discovery.pages.brief.assumptions",
          starter:
            "projectTemplates:content.product-discovery.pages.brief.assumptionsStarter",
        },
        { heading: "projectTemplates:common.pages.results", starter: "-" },
        { heading: "projectTemplates:common.pages.decisions", starter: "" },
      ],
    },
  ],

  pageTemplates: [
    {
      name: "projectTemplates:content.product-discovery.pages.interview.title",
      logo: { kind: "icon", value: "MessageSquare" },
      sections: [
        {
          heading: "projectTemplates:common.pages.context",
          starter:
            "projectTemplates:content.product-discovery.pages.interview.contextStarter",
        },
        {
          heading:
            "projectTemplates:content.product-discovery.pages.interview.story",
          starter: "",
        },
        {
          heading:
            "projectTemplates:content.product-discovery.pages.interview.pains",
          starter: "-",
        },
        { heading: "projectTemplates:common.pages.workaround", starter: "-" },
        {
          heading:
            "projectTemplates:content.product-discovery.pages.interview.quotes",
          starter: "-",
        },
        {
          heading:
            "projectTemplates:content.product-discovery.pages.interview.surprises",
          starter: "-",
        },
      ],
    },
  ],

  whiteboards: [
    {
      title: "projectTemplates:content.product-discovery.boards.problemMap",
      icon: "💡",
      board: "brainstorm",
    },
    {
      title: "projectTemplates:content.product-discovery.boards.flowSketch",
      icon: "✏️",
      board: "flowchart",
    },
  ],

  sample: {
    tasks: [
      {
        key: "cart",
        title: "projectTemplates:content.product-discovery.samples.cart",
        description:
          "projectTemplates:content.product-discovery.samples.cartDescription",
        column: "discovering",
        priority: "high",
        labels: ["customer-request"],
        assignee: "creator",
        customFields: {
          evidence: "problem-confirmed",
          source: "support",
          "target-outcome":
            "projectTemplates:content.product-discovery.samples.cartOutcome",
        },
      },
      {
        key: "saved-reports",
        title:
          "projectTemplates:content.product-discovery.samples.savedReports",
        column: "idea",
        priority: "no-priority",
        customFields: { evidence: "none-yet", source: "sales" },
      },
      {
        key: "guided-setup",
        title: "projectTemplates:content.product-discovery.samples.guidedSetup",
        column: "up-next",
        priority: "medium",
        customFields: {
          evidence: "none-yet",
          source: "data",
          "target-outcome":
            "projectTemplates:content.product-discovery.samples.guidedSetupOutcome",
        },
      },
      {
        key: "priority-support",
        title:
          "projectTemplates:content.product-discovery.samples.prioritySupport",
        description:
          "projectTemplates:content.product-discovery.samples.prioritySupportDescription",
        column: "discovering",
        priority: "medium",
        labels: ["experiment"],
        customFields: { evidence: "none-yet", source: "team" },
        subtasks: [
          "projectTemplates:content.product-discovery.subtasks.planTest",
          "projectTemplates:content.product-discovery.subtasks.runTest",
          "projectTemplates:content.product-discovery.subtasks.writeUpResult",
        ],
      },
      {
        key: "bulk-prices",
        title: "projectTemplates:content.product-discovery.samples.bulkPrices",
        column: "building",
        priority: "high",
        dueInDays: 21,
        customFields: {
          evidence: "solution-tested",
          source: "customer",
          "target-outcome":
            "projectTemplates:content.product-discovery.samples.bulkPricesOutcome",
        },
      },
      {
        key: "dark-mode",
        title: "projectTemplates:content.product-discovery.samples.darkMode",
        description:
          "projectTemplates:content.product-discovery.samples.darkModeDescription",
        column: "parked",
        priority: "low",
        labels: ["customer-request"],
        customFields: { evidence: "problem-confirmed", source: "customer" },
      },
    ],
  },
};

export default template;
