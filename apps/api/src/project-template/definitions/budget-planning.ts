import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/budget-planning.md

const template: ProjectTemplate = {
  id: "budget-planning",
  version: 1,
  categories: ["finance", "work-management"],
  icon: "Wallet",
  name: "projectTemplates:catalog.budget-planning.name",
  pitch: "projectTemplates:catalog.budget-planning.pitch",
  description: "projectTemplates:catalog.budget-planning.description",
  suggestedKey: "BUD",

  project: {
    description: "projectTemplates:content.budget-planning.projectDescription",
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
      key: "not-started",
      name: "projectTemplates:common.statuses.notStarted",
      group: "unstarted",
    },
    {
      key: "drafting",
      name: "projectTemplates:common.statuses.drafting",
      group: "started",
    },
    {
      key: "submitted",
      name: "projectTemplates:common.statuses.submitted",
      group: "started",
    },
    {
      key: "in-review",
      name: "projectTemplates:common.statuses.inReview",
      group: "started",
    },
    {
      key: "approved",
      name: "projectTemplates:common.statuses.approved",
      group: "completed",
    },
    {
      key: "withdrawn",
      name: "projectTemplates:common.statuses.withdrawn",
      group: "cancelled",
    },
  ],

  labels: [
    {
      key: "headcount",
      name: "projectTemplates:content.budget-planning.labels.headcount",
      color: "purple",
    },
    {
      key: "capital",
      name: "projectTemplates:content.budget-planning.labels.capital",
      color: "dark-gray",
    },
    {
      key: "new-initiative",
      name: "projectTemplates:content.budget-planning.labels.newInitiative",
      color: "green",
    },
    {
      key: "saving-option",
      name: "projectTemplates:content.budget-planning.labels.savingOption",
      color: "orange",
    },
  ],

  customFields: [
    {
      key: "department",
      name: "projectTemplates:content.budget-planning.fields.department",
      type: "dropdown",
      options: [
        {
          key: "operations",
          label: "projectTemplates:common.options.operations",
        },
        { key: "sales", label: "projectTemplates:common.options.sales" },
        {
          key: "marketing",
          label: "projectTemplates:common.options.marketing",
        },
        {
          key: "engineering",
          label: "projectTemplates:common.options.engineering",
        },
        { key: "people", label: "projectTemplates:common.options.people" },
        { key: "finance", label: "projectTemplates:common.options.finance" },
      ],
    },
    {
      key: "requested",
      name: "projectTemplates:content.budget-planning.fields.requested",
      type: "number",
    },
    {
      key: "approved",
      name: "projectTemplates:content.budget-planning.fields.approved",
      type: "number",
    },
  ],

  views: [
    {
      name: "projectTemplates:content.budget-planning.views.submissionTracker",
      description:
        "projectTemplates:content.budget-planning.views.submissionTrackerDescription",
      filters: {
        root: { key: "group", operator: "notIn", values: ["cancelled"] },
      },
      display: { layout: "spreadsheet", groupBy: "status" },
      displayProperties: {
        dueDate: true,
        customFields: ["department", "requested", "approved"],
      },
    },
    {
      name: "projectTemplates:content.budget-planning.views.byDepartment",
      display: {
        layout: "list",
        groupBy: { customField: "department" },
        orderBy: { field: "dueDate", direction: "asc" },
      },
    },
    {
      name: "projectTemplates:content.budget-planning.views.budgetCalendar",
      filters: {
        root: {
          key: "group",
          operator: "notIn",
          values: ["completed", "cancelled"],
        },
      },
      display: { layout: "calendar", groupBy: null },
    },
  ],

  taskTemplates: [
    {
      name: "projectTemplates:content.budget-planning.taskTemplates.departmentSubmission.name",
      titlePattern:
        "projectTemplates:content.budget-planning.taskTemplates.departmentSubmission.titlePattern",
      description:
        "projectTemplates:content.budget-planning.taskTemplates.departmentSubmission.description",
      priority: "high",
    },
    {
      name: "projectTemplates:content.budget-planning.taskTemplates.reviewSubmission.name",
      titlePattern:
        "projectTemplates:content.budget-planning.taskTemplates.reviewSubmission.titlePattern",
      description:
        "projectTemplates:content.budget-planning.taskTemplates.reviewSubmission.description",
      column: "in-review",
      priority: "medium",
    },
  ],

  automationRules: [
    {
      name: "projectTemplates:content.budget-planning.rules.submitted",
      trigger: { type: "status_changed", to: ["submitted"] },
      actions: [
        {
          type: "notify",
          roles: ["lead"],
          message:
            "projectTemplates:content.budget-planning.rules.submittedMessage",
        },
        {
          type: "add_comment",
          template:
            "projectTemplates:content.budget-planning.rules.submittedComment",
        },
      ],
    },
    {
      name: "projectTemplates:content.budget-planning.rules.overdue",
      trigger: { type: "due_date_passed" },
      actions: [
        {
          type: "notify",
          roles: ["assignees"],
          message:
            "projectTemplates:content.budget-planning.rules.overdueMessage",
        },
      ],
    },
  ],

  pages: [
    {
      key: "guidelines",
      title: "projectTemplates:content.budget-planning.pages.guidelines.title",
      logo: { kind: "icon", value: "ScrollText" },
      sections: [
        {
          heading: "projectTemplates:common.pages.timeline",
          starter:
            "projectTemplates:content.budget-planning.pages.guidelines.timelineStarter",
        },
        {
          heading:
            "projectTemplates:content.budget-planning.pages.guidelines.assumptions",
          starter:
            "projectTemplates:content.budget-planning.pages.guidelines.assumptionsStarter",
        },
        {
          heading:
            "projectTemplates:content.budget-planning.pages.guidelines.format",
          starter:
            "projectTemplates:content.budget-planning.pages.guidelines.formatStarter",
        },
        {
          heading: "projectTemplates:common.pages.whoApproves",
          starter:
            "projectTemplates:content.budget-planning.pages.guidelines.whoApprovesStarter",
        },
        {
          heading:
            "projectTemplates:content.budget-planning.pages.guidelines.publication",
          starter:
            "projectTemplates:content.budget-planning.pages.guidelines.publicationStarter",
        },
      ],
    },
  ],

  sample: {
    tasks: [
      {
        key: "guidelines",
        title: "projectTemplates:content.budget-planning.samples.guidelines",
        column: "approved",
        priority: "high",
        assignee: "creator",
        dueInDays: -7,
      },
      {
        key: "marketing",
        title: "projectTemplates:content.budget-planning.samples.marketing",
        description:
          "projectTemplates:content.budget-planning.samples.marketingDescription",
        column: "submitted",
        priority: "high",
        dueInDays: 7,
        customFields: { department: "marketing", requested: "180000" },
        relations: [{ type: "blocks", to: "consolidate" }],
      },
      {
        key: "engineering",
        title: "projectTemplates:content.budget-planning.samples.engineering",
        column: "drafting",
        priority: "high",
        labels: ["headcount"],
        dueInDays: 7,
        customFields: { department: "engineering" },
        relations: [{ type: "blocks", to: "consolidate" }],
      },
      {
        key: "operations",
        title: "projectTemplates:content.budget-planning.samples.operations",
        description:
          "projectTemplates:content.budget-planning.samples.operationsDescription",
        column: "in-review",
        priority: "high",
        labels: ["capital"],
        dueInDays: 7,
        customFields: { department: "operations", requested: "95000" },
        relations: [{ type: "blocks", to: "consolidate" }],
      },
      {
        key: "sales",
        title: "projectTemplates:content.budget-planning.samples.sales",
        column: "not-started",
        priority: "high",
        dueInDays: 7,
        customFields: { department: "sales" },
        relations: [{ type: "blocks", to: "consolidate" }],
      },
      {
        key: "portal",
        title: "projectTemplates:content.budget-planning.samples.portal",
        description:
          "projectTemplates:content.budget-planning.samples.portalDescription",
        column: "submitted",
        priority: "medium",
        labels: ["new-initiative"],
        dueInDays: 7,
        customFields: { department: "engineering", requested: "40000" },
        relations: [{ type: "related", to: "engineering" }],
      },
      {
        key: "consolidate",
        title: "projectTemplates:content.budget-planning.samples.consolidate",
        description:
          "projectTemplates:content.budget-planning.samples.consolidateDescription",
        column: "not-started",
        priority: "urgent",
        assignee: "creator",
        startInDays: 8,
        dueInDays: 21,
        isMilestone: true,
        customFields: { department: "finance" },
      },
    ],
  },
};

export default template;
