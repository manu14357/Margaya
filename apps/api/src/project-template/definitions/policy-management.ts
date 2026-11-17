import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/policy-management.md

const template: ProjectTemplate = {
  id: "policy-management",
  version: 1,
  categories: ["human-resources", "work-management"],
  icon: "ScrollText",
  name: "projectTemplates:catalog.policy-management.name",
  pitch: "projectTemplates:catalog.policy-management.pitch",
  description: "projectTemplates:catalog.policy-management.description",
  suggestedKey: "POL",

  project: {
    description:
      "projectTemplates:content.policy-management.projectDescription",
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

  columns: [
    {
      key: "requested",
      name: "projectTemplates:common.statuses.requested",
      group: "unstarted",
    },
    {
      key: "drafting",
      name: "projectTemplates:common.statuses.drafting",
      group: "started",
    },
    {
      key: "in-review",
      name: "projectTemplates:common.statuses.inReview",
      group: "started",
    },
    {
      key: "awaiting-approval",
      name: "projectTemplates:common.statuses.awaitingApproval",
      group: "started",
    },
    {
      key: "published",
      name: "projectTemplates:common.statuses.published",
      group: "completed",
    },
    {
      // Not common.statuses.retired: several locales word that one for
      // equipment taken out of service, which reads wrong for a policy.
      key: "retired",
      name: "projectTemplates:content.policy-management.statuses.retired",
      group: "cancelled",
    },
  ],

  labels: [
    {
      key: "people",
      name: "projectTemplates:content.policy-management.labels.people",
      color: "purple",
    },
    {
      key: "security",
      name: "projectTemplates:common.labels.security",
      color: "red",
    },
    {
      key: "finance",
      name: "projectTemplates:content.policy-management.labels.finance",
      color: "yellow",
    },
    {
      key: "operations",
      name: "projectTemplates:content.policy-management.labels.operations",
      color: "teal",
    },
  ],

  customFields: [
    {
      key: "owner",
      name: "projectTemplates:content.policy-management.fields.owner",
      type: "text",
    },
    {
      key: "version",
      name: "projectTemplates:common.fields.version",
      type: "text",
    },
    {
      key: "acknowledgement",
      name: "projectTemplates:content.policy-management.fields.acknowledgement",
      type: "boolean",
    },
  ],

  views: [
    {
      name: "projectTemplates:content.policy-management.views.register",
      description:
        "projectTemplates:content.policy-management.views.registerDescription",
      filters: {
        root: { key: "group", operator: "notIn", values: ["cancelled"] },
      },
      display: { layout: "spreadsheet", groupBy: "label" },
      displayProperties: {
        status: true,
        dueDate: true,
        customFields: ["owner", "version"],
      },
    },
    {
      name: "projectTemplates:content.policy-management.views.reviewsDueSoon",
      description:
        "projectTemplates:content.policy-management.views.reviewsDueSoonDescription",
      filters: {
        root: {
          op: "and",
          children: [
            {
              key: "dueDate",
              operator: "withinNext",
              amount: 60,
              unit: "days",
            },
            { key: "group", operator: "notIn", values: ["cancelled"] },
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
      name: "projectTemplates:content.policy-management.views.reviewCalendar",
      filters: {
        root: { key: "group", operator: "notIn", values: ["cancelled"] },
      },
      display: { layout: "calendar", groupBy: null },
    },
  ],

  taskTemplates: [
    {
      name: "projectTemplates:content.policy-management.taskTemplates.newPolicy.name",
      description:
        "projectTemplates:content.policy-management.taskTemplates.newPolicy.description",
      priority: "medium",
    },
    {
      name: "projectTemplates:content.policy-management.taskTemplates.policyReview.name",
      description:
        "projectTemplates:content.policy-management.taskTemplates.policyReview.description",
      priority: "medium",
    },
  ],

  automationRules: [
    {
      name: "projectTemplates:content.policy-management.rules.approvalNeeded",
      trigger: { type: "status_changed", to: ["awaiting-approval"] },
      actions: [
        {
          type: "notify",
          roles: ["lead"],
          message:
            "projectTemplates:content.policy-management.rules.approvalMessage",
        },
      ],
    },
    {
      name: "projectTemplates:content.policy-management.rules.announceOnPublish",
      trigger: { type: "status_changed", to: ["published"] },
      actions: [
        {
          type: "create_subtask",
          title: "projectTemplates:content.policy-management.subtasks.announce",
        },
      ],
    },
  ],

  pages: [
    {
      key: "how-we-manage",
      title: "projectTemplates:content.policy-management.pages.guide.title",
      logo: { kind: "icon", value: "ScrollText" },
      sections: [
        {
          heading: "projectTemplates:content.policy-management.pages.guide.who",
          starter:
            "projectTemplates:content.policy-management.pages.guide.whoStarter",
        },
        {
          heading:
            "projectTemplates:content.policy-management.pages.guide.reviewRule",
          starter:
            "projectTemplates:content.policy-management.pages.guide.reviewRuleStarter",
        },
        {
          heading: "projectTemplates:common.pages.whoApproves",
          starter:
            "projectTemplates:content.policy-management.pages.guide.whoApprovesStarter",
        },
        {
          heading:
            "projectTemplates:content.policy-management.pages.guide.where",
          starter:
            "projectTemplates:content.policy-management.pages.guide.whereStarter",
        },
      ],
    },
  ],

  // The plan lists the policy template as a starter page; it is a page
  // template so each policy can be drafted on its own copy.
  pageTemplates: [
    {
      name: "projectTemplates:content.policy-management.pages.policy.title",
      logo: { kind: "icon", value: "FileText" },
      sections: [
        {
          heading: "projectTemplates:common.pages.purpose",
          starter:
            "projectTemplates:content.policy-management.pages.policy.purposeStarter",
        },
        { heading: "projectTemplates:common.pages.scope", starter: "" },
        {
          heading:
            "projectTemplates:content.policy-management.pages.policy.statements",
          starter: "1.",
        },
        { heading: "projectTemplates:common.pages.roles", starter: "-" },
        {
          heading:
            "projectTemplates:content.policy-management.pages.policy.exceptions",
          starter:
            "projectTemplates:content.policy-management.pages.policy.exceptionsStarter",
        },
        {
          heading:
            "projectTemplates:content.policy-management.pages.policy.related",
          starter: "-",
        },
        {
          heading:
            "projectTemplates:content.policy-management.pages.policy.history",
          starter:
            "projectTemplates:content.policy-management.pages.policy.historyStarter",
        },
      ],
    },
  ],

  sample: {
    tasks: [
      {
        key: "remote-work",
        title: "projectTemplates:content.policy-management.samples.remoteWork",
        description:
          "projectTemplates:content.policy-management.samples.remoteWorkDescription",
        column: "awaiting-approval",
        priority: "medium",
        labels: ["people"],
        assignee: "creator",
        dueInDays: 7,
        customFields: {
          owner:
            "projectTemplates:content.policy-management.samples.ownerPeople",
          version: "projectTemplates:content.policy-management.samples.v20",
          acknowledgement: "true",
        },
        recurrence: { frequency: "yearly", trigger: "completion" },
      },
      {
        key: "devices",
        title: "projectTemplates:content.policy-management.samples.devices",
        column: "in-review",
        priority: "high",
        labels: ["security"],
        dueInDays: 14,
        customFields: {
          owner:
            "projectTemplates:content.policy-management.samples.ownerSecurity",
          version: "projectTemplates:content.policy-management.samples.v31",
        },
        recurrence: { frequency: "yearly", trigger: "completion" },
      },
      {
        key: "expenses",
        title: "projectTemplates:content.policy-management.samples.expenses",
        description:
          "projectTemplates:content.policy-management.samples.expensesDescription",
        column: "requested",
        priority: "medium",
        labels: ["finance"],
        dueInDays: 30,
        customFields: {
          owner:
            "projectTemplates:content.policy-management.samples.ownerFinance",
          version: "projectTemplates:content.policy-management.samples.v40",
        },
        recurrence: { frequency: "yearly", trigger: "completion" },
      },
      {
        key: "visitors",
        title: "projectTemplates:content.policy-management.samples.visitors",
        column: "published",
        priority: "low",
        labels: ["operations"],
        dueInDays: 300,
        customFields: {
          owner:
            "projectTemplates:content.policy-management.samples.ownerOperations",
          version: "projectTemplates:content.policy-management.samples.v12",
        },
        subtasks: [
          "projectTemplates:content.policy-management.subtasks.announce",
        ],
      },
      {
        key: "social-media",
        title: "projectTemplates:content.policy-management.samples.socialMedia",
        column: "drafting",
        priority: "low",
        labels: ["people"],
        dueInDays: 45,
        customFields: {
          owner:
            "projectTemplates:content.policy-management.samples.ownerPeople",
          version: "projectTemplates:content.policy-management.samples.v10",
        },
      },
      {
        key: "paper-records",
        title:
          "projectTemplates:content.policy-management.samples.paperRecords",
        description:
          "projectTemplates:content.policy-management.samples.paperRecordsDescription",
        column: "retired",
        priority: "low",
        labels: ["operations"],
        customFields: {
          owner:
            "projectTemplates:content.policy-management.samples.ownerOperations",
        },
      },
    ],
  },
};

export default template;
