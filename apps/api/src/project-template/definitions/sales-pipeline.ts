import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/sales-pipeline.md

const template: ProjectTemplate = {
  id: "sales-pipeline",
  version: 1,
  categories: ["sales", "work-management"],
  icon: "Target",
  name: "projectTemplates:catalog.sales-pipeline.name",
  pitch: "projectTemplates:catalog.sales-pipeline.pitch",
  description: "projectTemplates:catalog.sales-pipeline.description",
  suggestedKey: "DEAL",

  project: {
    description: "projectTemplates:content.sales-pipeline.projectDescription",
    features: {
      cycles: false,
      modules: false,
      views: true,
      pages: true,
      whiteboards: false,
      intake: false,
      estimates: false,
      timeTracking: false,
      ai: false,
      updates: false,
    },
    lead: "creator",
  },

  // Columns are the stages: dragging a card is the stage update.
  columns: [
    {
      key: "lead",
      name: "projectTemplates:content.sales-pipeline.statuses.lead",
      group: "unstarted",
    },
    {
      key: "qualified",
      name: "projectTemplates:common.statuses.qualified",
      group: "started",
    },
    {
      key: "proposal",
      name: "projectTemplates:content.sales-pipeline.statuses.proposal",
      group: "started",
    },
    {
      key: "negotiation",
      name: "projectTemplates:content.sales-pipeline.statuses.negotiation",
      group: "started",
    },
    {
      key: "won",
      name: "projectTemplates:content.sales-pipeline.statuses.won",
      group: "completed",
    },
    {
      key: "lost",
      name: "projectTemplates:common.statuses.lost",
      group: "cancelled",
    },
  ],

  labels: [
    {
      key: "new-business",
      name: "projectTemplates:content.sales-pipeline.labels.newBusiness",
      color: "green",
    },
    {
      key: "expansion",
      name: "projectTemplates:content.sales-pipeline.labels.expansion",
      color: "teal",
    },
    {
      key: "renewal",
      name: "projectTemplates:common.labels.renewal",
      color: "purple",
    },
  ],

  // The due date is the expected close date; priority marks this week's focus.
  customFields: [
    {
      key: "deal-value",
      name: "projectTemplates:common.fields.dealValue",
      type: "number",
    },
    {
      key: "company",
      name: "projectTemplates:common.fields.company",
      type: "text",
    },
    {
      key: "source",
      name: "projectTemplates:common.fields.source",
      type: "dropdown",
      options: [
        { key: "referral", label: "projectTemplates:common.options.referral" },
        { key: "website", label: "projectTemplates:common.options.website" },
        { key: "outbound", label: "projectTemplates:common.options.outbound" },
        { key: "event", label: "projectTemplates:common.options.event" },
        {
          key: "partner",
          label:
            "projectTemplates:content.sales-pipeline.options.source.partner",
        },
      ],
    },
    {
      key: "lost-reason",
      name: "projectTemplates:content.sales-pipeline.fields.lostReason",
      type: "dropdown",
      options: [
        {
          key: "price",
          label:
            "projectTemplates:content.sales-pipeline.options.lostReason.price",
        },
        {
          key: "timing",
          label:
            "projectTemplates:content.sales-pipeline.options.lostReason.timing",
        },
        {
          key: "went-elsewhere",
          label:
            "projectTemplates:content.sales-pipeline.options.lostReason.wentElsewhere",
        },
        {
          key: "no-decision",
          label:
            "projectTemplates:content.sales-pipeline.options.lostReason.noDecision",
        },
        {
          key: "not-a-fit",
          label:
            "projectTemplates:content.sales-pipeline.options.lostReason.notAFit",
        },
      ],
    },
  ],

  views: [
    {
      name: "projectTemplates:common.views.pipeline",
      description:
        "projectTemplates:content.sales-pipeline.views.pipelineDescription",
      filters: {
        root: { key: "group", operator: "notIn", values: ["cancelled"] },
      },
      display: {
        layout: "board",
        groupBy: "status",
        orderBy: { field: { customField: "deal-value" }, direction: "desc" },
      },
    },
    {
      name: "projectTemplates:content.sales-pipeline.views.closingThisMonth",
      description:
        "projectTemplates:content.sales-pipeline.views.closingThisMonthDescription",
      filters: {
        root: {
          op: "and",
          children: [
            { key: "dueDate", operator: "in", values: ["thisMonth"] },
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
        orderBy: { field: { customField: "deal-value" }, direction: "desc" },
      },
    },
    {
      name: "projectTemplates:content.sales-pipeline.views.dealsSheet",
      filters: { root: null },
      display: {
        layout: "spreadsheet",
        groupBy: null,
        orderBy: { field: "dueDate", direction: "asc" },
      },
      displayProperties: {
        assignee: true,
        dueDate: true,
        customFields: ["company", "deal-value", "source"],
      },
    },
    {
      name: "projectTemplates:content.sales-pipeline.views.lostDeals",
      filters: {
        root: { key: "status", operator: "in", columns: ["lost"] },
      },
      display: {
        layout: "list",
        groupBy: { customField: "lost-reason" },
        orderBy: { field: "updatedAt", direction: "desc" },
      },
    },
  ],

  taskTemplates: [
    {
      name: "projectTemplates:content.sales-pipeline.taskTemplates.deal.name",
      description:
        "projectTemplates:content.sales-pipeline.taskTemplates.deal.description",
      column: "lead",
      priority: "medium",
      subtasks: [
        "projectTemplates:content.sales-pipeline.subtasks.discoveryCall",
        "projectTemplates:content.sales-pipeline.subtasks.confirmNeed",
        "projectTemplates:content.sales-pipeline.subtasks.sendProposal",
        "projectTemplates:content.sales-pipeline.subtasks.followUp",
      ],
    },
  ],

  automationRules: [
    {
      name: "projectTemplates:content.sales-pipeline.rules.lostReason",
      trigger: { type: "status_changed", to: ["lost"] },
      actions: [
        {
          type: "add_comment",
          template:
            "projectTemplates:content.sales-pipeline.rules.lostReasonComment",
        },
      ],
    },
    {
      name: "projectTemplates:content.sales-pipeline.rules.dealWon",
      trigger: { type: "status_changed", to: ["won"] },
      actions: [
        {
          type: "notify",
          roles: ["lead"],
          message:
            "projectTemplates:content.sales-pipeline.rules.dealWonMessage",
        },
      ],
    },
    {
      name: "projectTemplates:content.sales-pipeline.rules.closeDatePassed",
      trigger: { type: "due_date_passed" },
      // Won and Lost deals are closed; only open deals can slip.
      conditions: {
        op: "and",
        conditions: [
          { field: "status", op: "is_not", columns: ["won", "lost"] },
        ],
      },
      actions: [
        {
          type: "add_comment",
          template:
            "projectTemplates:content.sales-pipeline.rules.closeDatePassedComment",
        },
        {
          type: "notify",
          roles: ["assignees"],
          message:
            "projectTemplates:content.sales-pipeline.rules.closeDatePassedMessage",
        },
      ],
    },
  ],

  pages: [
    {
      key: "stage-guide",
      title: "projectTemplates:content.sales-pipeline.pages.stageGuide.title",
      logo: { kind: "icon", value: "ScrollText" },
      sections: [
        {
          heading:
            "projectTemplates:content.sales-pipeline.pages.stageGuide.lead",
          starter:
            "projectTemplates:content.sales-pipeline.pages.stageGuide.leadStarter",
        },
        {
          heading:
            "projectTemplates:content.sales-pipeline.pages.stageGuide.qualified",
          starter:
            "projectTemplates:content.sales-pipeline.pages.stageGuide.qualifiedStarter",
        },
        {
          heading:
            "projectTemplates:content.sales-pipeline.pages.stageGuide.proposal",
          starter:
            "projectTemplates:content.sales-pipeline.pages.stageGuide.proposalStarter",
        },
        {
          heading:
            "projectTemplates:content.sales-pipeline.pages.stageGuide.negotiation",
          starter:
            "projectTemplates:content.sales-pipeline.pages.stageGuide.negotiationStarter",
        },
        {
          heading:
            "projectTemplates:content.sales-pipeline.pages.stageGuide.outcome",
          starter:
            "projectTemplates:content.sales-pipeline.pages.stageGuide.outcomeStarter",
        },
      ],
    },
    {
      key: "proposal-checklist",
      title:
        "projectTemplates:content.sales-pipeline.pages.proposalChecklist.title",
      logo: { kind: "icon", value: "List" },
      sections: [
        {
          heading: "projectTemplates:common.pages.scope",
          starter:
            "projectTemplates:content.sales-pipeline.pages.proposalChecklist.scopeStarter",
        },
        {
          heading:
            "projectTemplates:content.sales-pipeline.pages.proposalChecklist.price",
          starter:
            "projectTemplates:content.sales-pipeline.pages.proposalChecklist.priceStarter",
        },
        {
          heading:
            "projectTemplates:content.sales-pipeline.pages.proposalChecklist.terms",
          starter:
            "projectTemplates:content.sales-pipeline.pages.proposalChecklist.termsStarter",
        },
        {
          heading: "projectTemplates:common.pages.timeline",
          starter:
            "projectTemplates:content.sales-pipeline.pages.proposalChecklist.timelineStarter",
        },
        {
          heading:
            "projectTemplates:content.sales-pipeline.pages.proposalChecklist.whoSigns",
          starter:
            "projectTemplates:content.sales-pipeline.pages.proposalChecklist.whoSignsStarter",
        },
      ],
    },
  ],

  // Fictional customers; all names are made up.
  sample: {
    tasks: [
      {
        key: "larchmont",
        title: "projectTemplates:content.sales-pipeline.samples.larchmont",
        description:
          "projectTemplates:content.sales-pipeline.samples.larchmontDescription",
        column: "negotiation",
        priority: "high",
        labels: ["new-business"],
        assignee: "creator",
        dueInDays: 10,
        customFields: {
          "deal-value": "18000",
          company:
            "projectTemplates:content.sales-pipeline.samples.larchmontCompany",
          source: "referral",
        },
      },
      {
        key: "quayside",
        title: "projectTemplates:content.sales-pipeline.samples.quayside",
        column: "proposal",
        priority: "medium",
        labels: ["expansion"],
        dueInDays: 18,
        customFields: {
          "deal-value": "6000",
          company:
            "projectTemplates:content.sales-pipeline.samples.quaysideCompany",
          source: "outbound",
        },
      },
      {
        key: "otterburn",
        title: "projectTemplates:content.sales-pipeline.samples.otterburn",
        description:
          "projectTemplates:content.sales-pipeline.samples.otterburnDescription",
        column: "qualified",
        priority: "medium",
        labels: ["renewal"],
        dueInDays: -2,
        customFields: {
          "deal-value": "4500",
          company:
            "projectTemplates:content.sales-pipeline.samples.otterburnCompany",
        },
      },
      {
        key: "pellow-finch",
        title: "projectTemplates:content.sales-pipeline.samples.pellowFinch",
        column: "lead",
        priority: "low",
        labels: ["new-business"],
        dueInDays: 45,
        customFields: {
          "deal-value": "2500",
          company:
            "projectTemplates:content.sales-pipeline.samples.pellowFinchCompany",
          source: "website",
        },
      },
      {
        key: "glenrock",
        title: "projectTemplates:content.sales-pipeline.samples.glenrock",
        column: "won",
        priority: "low",
        labels: ["new-business"],
        dueInDays: -5,
        customFields: {
          "deal-value": "1200",
          company:
            "projectTemplates:content.sales-pipeline.samples.glenrockCompany",
          source: "event",
        },
      },
      {
        key: "ashby",
        title: "projectTemplates:content.sales-pipeline.samples.ashby",
        description:
          "projectTemplates:content.sales-pipeline.samples.ashbyDescription",
        column: "lost",
        priority: "low",
        labels: ["new-business"],
        dueInDays: -12,
        customFields: {
          "deal-value": "9000",
          company:
            "projectTemplates:content.sales-pipeline.samples.ashbyCompany",
          "lost-reason": "timing",
        },
      },
    ],
  },
};

export default template;
