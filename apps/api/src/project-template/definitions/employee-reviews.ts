import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/employee-reviews.md

const CLOSED = ["completed", "cancelled"] as const;

const template: ProjectTemplate = {
  id: "employee-reviews",
  version: 1,
  categories: ["human-resources", "work-management"],
  icon: "MessageSquare",
  name: "projectTemplates:catalog.employee-reviews.name",
  pitch: "projectTemplates:catalog.employee-reviews.pitch",
  description: "projectTemplates:catalog.employee-reviews.description",
  suggestedKey: "REV",
  // Review progress is personnel data: only HR and the managers taking part
  // (plus workspace owners and admins) should see it.
  suggestedVisibility: "restricted",

  project: {
    description: "projectTemplates:content.employee-reviews.projectDescription",
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
      key: "self-review",
      name: "projectTemplates:content.employee-reviews.statuses.selfReview",
      group: "started",
    },
    {
      key: "manager-review",
      name: "projectTemplates:content.employee-reviews.statuses.managerReview",
      group: "started",
    },
    {
      key: "calibration",
      name: "projectTemplates:content.employee-reviews.statuses.calibration",
      group: "started",
    },
    {
      key: "conversation",
      name: "projectTemplates:content.employee-reviews.statuses.conversation",
      group: "started",
    },
    {
      key: "closed",
      name: "projectTemplates:common.statuses.closed",
      group: "completed",
    },
    {
      key: "deferred",
      name: "projectTemplates:content.employee-reviews.statuses.deferred",
      group: "cancelled",
    },
  ],

  labels: [
    {
      key: "programme-step",
      name: "projectTemplates:content.employee-reviews.labels.programmeStep",
      color: "dark-gray",
    },
    {
      key: "needs-hr-help",
      name: "projectTemplates:content.employee-reviews.labels.needsHrHelp",
      color: "yellow",
    },
  ],

  customFields: [
    {
      key: "team",
      name: "projectTemplates:common.fields.team",
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
      key: "review-type",
      name: "projectTemplates:content.employee-reviews.fields.reviewType",
      type: "dropdown",
      options: [
        {
          key: "yearly",
          label:
            "projectTemplates:content.employee-reviews.options.reviewType.yearly",
        },
        {
          key: "mid-year",
          label:
            "projectTemplates:content.employee-reviews.options.reviewType.midYear",
        },
        {
          key: "probation",
          label:
            "projectTemplates:content.employee-reviews.options.reviewType.probation",
        },
      ],
    },
    {
      key: "self-review-in",
      name: "projectTemplates:content.employee-reviews.fields.selfReviewIn",
      type: "boolean",
      defaultValue: "false",
    },
  ],

  views: [
    {
      name: "projectTemplates:content.employee-reviews.views.progressByTeam",
      description:
        "projectTemplates:content.employee-reviews.views.progressByTeamDescription",
      filters: {
        root: { key: "label", operator: "notIn", labels: ["programme-step"] },
      },
      display: {
        layout: "list",
        groupBy: { customField: "team" },
        subGroupBy: "status",
      },
    },
    {
      name: "projectTemplates:content.employee-reviews.views.myReviews",
      filters: {
        root: {
          op: "and",
          children: [
            { key: "assignee", operator: "in", values: ["me"] },
            { key: "group", operator: "notIn", values: CLOSED },
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
      name: "projectTemplates:common.views.overdue",
      filters: {
        root: {
          op: "and",
          children: [
            { key: "dueDate", operator: "in", values: ["past"] },
            { key: "group", operator: "notIn", values: CLOSED },
          ],
        },
      },
      display: {
        layout: "list",
        groupBy: { customField: "team" },
        orderBy: { field: "dueDate", direction: "asc" },
      },
    },
  ],

  taskTemplates: [
    {
      name: "projectTemplates:content.employee-reviews.taskTemplates.employeeReview.name",
      description:
        "projectTemplates:content.employee-reviews.taskTemplates.employeeReview.description",
      priority: "medium",
    },
    {
      name: "projectTemplates:content.employee-reviews.taskTemplates.cycleStep.name",
      description:
        "projectTemplates:content.employee-reviews.taskTemplates.cycleStep.description",
      priority: "high",
      labels: ["programme-step"],
    },
  ],

  automationRules: [
    {
      name: "projectTemplates:content.employee-reviews.rules.readyForCalibration",
      trigger: { type: "status_changed", to: ["calibration"] },
      actions: [
        {
          type: "notify",
          roles: ["lead"],
          message:
            "projectTemplates:content.employee-reviews.rules.readyForCalibrationMessage",
        },
      ],
    },
    {
      name: "projectTemplates:content.employee-reviews.rules.overdueStep",
      trigger: { type: "due_date_passed" },
      actions: [
        {
          type: "notify",
          roles: ["assignees"],
          message:
            "projectTemplates:content.employee-reviews.rules.overdueStepMessage",
        },
      ],
    },
    {
      name: "projectTemplates:content.employee-reviews.rules.hrHelp",
      trigger: { type: "label_added", labels: ["needs-hr-help"] },
      actions: [
        {
          type: "notify",
          roles: ["lead"],
          message:
            "projectTemplates:content.employee-reviews.rules.hrHelpMessage",
        },
      ],
    },
  ],

  pages: [
    {
      key: "review-guide",
      title:
        "projectTemplates:content.employee-reviews.pages.reviewGuide.title",
      logo: { kind: "icon", value: "BookOpen" },
      sections: [
        {
          heading: "projectTemplates:common.pages.timeline",
          starter:
            "projectTemplates:content.employee-reviews.pages.reviewGuide.timelineStarter",
        },
        {
          heading:
            "projectTemplates:content.employee-reviews.pages.reviewGuide.criteria",
          starter:
            "projectTemplates:content.employee-reviews.pages.reviewGuide.criteriaStarter",
        },
        {
          heading:
            "projectTemplates:content.employee-reviews.pages.reviewGuide.selfReview",
          starter:
            "projectTemplates:content.employee-reviews.pages.reviewGuide.selfReviewStarter",
        },
        {
          heading:
            "projectTemplates:content.employee-reviews.pages.reviewGuide.calibration",
          starter:
            "projectTemplates:content.employee-reviews.pages.reviewGuide.calibrationStarter",
        },
        {
          heading:
            "projectTemplates:content.employee-reviews.pages.reviewGuide.conversation",
          starter:
            "projectTemplates:content.employee-reviews.pages.reviewGuide.conversationStarter",
        },
        {
          heading:
            "projectTemplates:content.employee-reviews.pages.reviewGuide.privacy",
          starter:
            "projectTemplates:content.employee-reviews.pages.reviewGuide.privacyStarter",
        },
      ],
    },
  ],

  sample: {
    tasks: [
      {
        key: "publish-guide",
        title: "projectTemplates:content.employee-reviews.samples.publishGuide",
        description:
          "projectTemplates:content.employee-reviews.samples.publishGuideDescription",
        column: "closed",
        priority: "high",
        labels: ["programme-step"],
        assignee: "creator",
        dueInDays: -7,
      },
      {
        key: "brief-managers",
        title:
          "projectTemplates:content.employee-reviews.samples.briefManagers",
        description:
          "projectTemplates:content.employee-reviews.samples.briefManagersDescription",
        column: "not-started",
        priority: "high",
        labels: ["programme-step"],
        assignee: "creator",
        dueInDays: 7,
        relations: [{ type: "blocks", to: "e031" }],
      },
      {
        key: "e014",
        title: "projectTemplates:content.employee-reviews.samples.e014",
        description:
          "projectTemplates:content.employee-reviews.samples.e014Description",
        column: "manager-review",
        priority: "medium",
        dueInDays: 5,
        customFields: {
          team: "operations",
          "review-type": "yearly",
          "self-review-in": "true",
        },
      },
      {
        key: "e022",
        title: "projectTemplates:content.employee-reviews.samples.e022",
        column: "self-review",
        priority: "medium",
        dueInDays: 3,
        customFields: {
          team: "sales",
          "review-type": "yearly",
          "self-review-in": "false",
        },
      },
      {
        key: "e031",
        title: "projectTemplates:content.employee-reviews.samples.e031",
        column: "calibration",
        priority: "medium",
        dueInDays: 10,
        customFields: {
          team: "engineering",
          "review-type": "yearly",
          "self-review-in": "true",
        },
      },
      {
        key: "e045",
        title: "projectTemplates:content.employee-reviews.samples.e045",
        description:
          "projectTemplates:content.employee-reviews.samples.e045Description",
        column: "not-started",
        priority: "low",
        dueInDays: 14,
        customFields: {
          team: "marketing",
          "review-type": "probation",
          "self-review-in": "false",
        },
      },
      {
        key: "close-cycle",
        title: "projectTemplates:content.employee-reviews.samples.closeCycle",
        description:
          "projectTemplates:content.employee-reviews.samples.closeCycleDescription",
        column: "not-started",
        priority: "medium",
        labels: ["programme-step"],
        dueInDays: 42,
      },
    ],
  },
};

export default template;
