import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/analytics-request-desk.md

const template: ProjectTemplate = {
  id: "analytics-request-desk",
  version: 1,
  categories: ["service-management", "analytics"],
  icon: "PieChart",
  name: "projectTemplates:catalog.analytics-request-desk.name",
  pitch: "projectTemplates:catalog.analytics-request-desk.pitch",
  description: "projectTemplates:catalog.analytics-request-desk.description",
  suggestedKey: "DATA",

  project: {
    description:
      "projectTemplates:content.analytics-request-desk.projectDescription",
    features: {
      cycles: false,
      modules: false,
      views: true,
      pages: true,
      whiteboards: false,
      intake: true,
      estimates: true,
      timeTracking: false,
      ai: false,
      updates: false,
    },
    lead: "creator",
  },

  columns: [
    {
      key: "up-next",
      name: "projectTemplates:common.statuses.upNext",
      group: "unstarted",
    },
    {
      key: "in-progress",
      name: "projectTemplates:common.statuses.inProgress",
      group: "started",
    },
    {
      key: "waiting-on-requester",
      name: "projectTemplates:common.statuses.waitingOnRequester",
      group: "started",
    },
    {
      key: "in-review",
      name: "projectTemplates:common.statuses.inReview",
      group: "started",
    },
    {
      key: "delivered",
      name: "projectTemplates:common.statuses.delivered",
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
      key: "recurring-ask",
      name: "projectTemplates:content.analytics-request-desk.labels.recurringAsk",
      color: "dark-gray",
    },
    {
      key: "data-quality",
      name: "projectTemplates:content.analytics-request-desk.labels.dataQuality",
      color: "orange",
    },
  ],

  customFields: [
    {
      key: "request-type",
      name: "projectTemplates:common.fields.requestType",
      type: "dropdown",
      options: [
        {
          key: "quick-question",
          label:
            "projectTemplates:content.analytics-request-desk.options.requestType.quickQuestion",
        },
        {
          key: "report-or-dashboard",
          label:
            "projectTemplates:content.analytics-request-desk.options.requestType.reportOrDashboard",
        },
        {
          key: "deep-dive",
          label:
            "projectTemplates:content.analytics-request-desk.options.requestType.deepDive",
        },
        {
          key: "data-pull",
          label:
            "projectTemplates:content.analytics-request-desk.options.requestType.dataPull",
        },
        {
          key: "check-a-number",
          label:
            "projectTemplates:content.analytics-request-desk.options.requestType.checkANumber",
        },
      ],
      defaultOption: "quick-question",
    },
    // The plan marks this field required on the form, but a required field
    // needs a default, and a canned answer would defeat the question.
    {
      key: "decision",
      name: "projectTemplates:content.analytics-request-desk.fields.decision",
      type: "text",
    },
    {
      key: "decision-size",
      name: "projectTemplates:content.analytics-request-desk.fields.decisionSize",
      type: "dropdown",
      options: [
        { key: "one-team", label: "projectTemplates:common.options.oneTeam" },
        {
          key: "one-department",
          label:
            "projectTemplates:content.analytics-request-desk.options.decisionSize.oneDepartment",
        },
        {
          key: "whole-organisation",
          label:
            "projectTemplates:content.analytics-request-desk.options.decisionSize.wholeOrganisation",
        },
      ],
    },
    {
      key: "needed-by",
      name: "projectTemplates:common.fields.neededBy",
      type: "date",
    },
  ],

  estimate: {
    name: "projectTemplates:content.analytics-request-desk.estimate.name",
    type: "points",
    values: ["1", "2", "3", "5", "8"],
  },

  views: [
    {
      name: "projectTemplates:common.views.myQueue",
      filters: {
        root: {
          op: "and",
          children: [
            { key: "assignee", operator: "in", values: ["me"] },
            { key: "group", operator: "in", values: ["unstarted", "started"] },
          ],
        },
      },
      display: {
        layout: "list",
        groupBy: "status",
        orderBy: { field: "dueDate", direction: "asc" },
      },
    },
    {
      name: "projectTemplates:common.views.unassigned",
      filters: {
        root: {
          op: "and",
          children: [
            { key: "assignee", operator: "in", values: ["none"] },
            { key: "group", operator: "in", values: ["unstarted", "started"] },
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
      name: "projectTemplates:common.views.dueSoon",
      filters: {
        root: {
          op: "and",
          children: [
            {
              op: "or",
              children: [
                {
                  key: "dueDate",
                  operator: "withinNext",
                  amount: 2,
                  unit: "days",
                },
                { key: "dueDate", operator: "in", values: ["past"] },
              ],
            },
            { key: "group", operator: "in", values: ["unstarted", "started"] },
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
      name: "projectTemplates:content.analytics-request-desk.views.valueAndEffort",
      description:
        "projectTemplates:content.analytics-request-desk.views.valueAndEffortDescription",
      filters: {
        root: {
          key: "group",
          operator: "in",
          values: ["unstarted", "started"],
        },
      },
      display: {
        layout: "spreadsheet",
        groupBy: null,
        orderBy: { field: "priority" },
      },
      displayProperties: {
        estimate: true,
        customFields: ["decision-size", "needed-by"],
      },
    },
  ],

  intakeForm: {
    title: "projectTemplates:content.analytics-request-desk.form.title",
    intro: "projectTemplates:content.analytics-request-desk.form.intro",
    descriptionField: "required",
    emailField: "required",
    nameField: "required",
    customFields: ["request-type", "decision", "decision-size", "needed-by"],
    confirmationMessage:
      "projectTemplates:content.analytics-request-desk.form.confirmation",
  },

  taskTemplates: [
    {
      name: "projectTemplates:content.analytics-request-desk.taskTemplates.quickQuestion.name",
      description:
        "projectTemplates:content.analytics-request-desk.taskTemplates.quickQuestion.description",
      priority: "low",
    },
    {
      name: "projectTemplates:content.analytics-request-desk.taskTemplates.reportOrDashboard.name",
      description:
        "projectTemplates:content.analytics-request-desk.taskTemplates.reportOrDashboard.description",
      priority: "medium",
    },
    {
      name: "projectTemplates:content.analytics-request-desk.taskTemplates.deepDive.name",
      description:
        "projectTemplates:content.analytics-request-desk.taskTemplates.deepDive.description",
      priority: "high",
    },
    {
      name: "projectTemplates:content.analytics-request-desk.taskTemplates.dataPull.name",
      description:
        "projectTemplates:content.analytics-request-desk.taskTemplates.dataPull.description",
      priority: "low",
    },
    {
      name: "projectTemplates:content.analytics-request-desk.taskTemplates.checkANumber.name",
      description:
        "projectTemplates:content.analytics-request-desk.taskTemplates.checkANumber.description",
      priority: "medium",
    },
  ],

  automationRules: [
    {
      name: "projectTemplates:content.analytics-request-desk.rules.quickQuestionsFirst",
      trigger: { type: "task_created", fromIntake: true },
      conditions: {
        op: "and",
        conditions: [
          {
            field: "custom_field",
            fieldKey: "request-type",
            op: "equals",
            value: "quick-question",
          },
        ],
      },
      actions: [{ type: "set_due_date", offsetDays: 1 }],
    },
    {
      name: "projectTemplates:content.analytics-request-desk.rules.lateOwner",
      trigger: { type: "due_date_passed" },
      actions: [
        {
          type: "notify",
          roles: ["assignees"],
          message:
            "projectTemplates:content.analytics-request-desk.rules.lateMessage",
        },
      ],
    },
  ],

  pages: [
    {
      key: "how-to-ask",
      title:
        "projectTemplates:content.analytics-request-desk.pages.howToAsk.title",
      logo: { kind: "icon", value: "BookOpen" },
      sections: [
        {
          heading:
            "projectTemplates:content.analytics-request-desk.pages.howToAsk.goodQuestion",
          starter:
            "projectTemplates:content.analytics-request-desk.pages.howToAsk.goodQuestionStarter",
        },
        {
          heading: "projectTemplates:common.pages.leadTimes",
          starter:
            "projectTemplates:content.analytics-request-desk.pages.howToAsk.leadTimesStarter",
        },
        {
          heading: "projectTemplates:common.pages.whatHappensNext",
          starter:
            "projectTemplates:content.analytics-request-desk.pages.howToAsk.whatHappensNextStarter",
        },
      ],
    },
    {
      key: "metric-definitions",
      title:
        "projectTemplates:content.analytics-request-desk.pages.metricDefinitions.title",
      logo: { kind: "icon", value: "Table" },
      sections: [
        {
          heading:
            "projectTemplates:content.analytics-request-desk.pages.metricDefinitions.howToAdd",
          starter:
            "projectTemplates:content.analytics-request-desk.pages.metricDefinitions.howToAddStarter",
        },
        {
          heading:
            "projectTemplates:content.analytics-request-desk.pages.metricDefinitions.example",
          starter:
            "projectTemplates:content.analytics-request-desk.pages.metricDefinitions.exampleStarter",
        },
      ],
    },
    {
      key: "review-checklist",
      title:
        "projectTemplates:content.analytics-request-desk.pages.reviewChecklist.title",
      logo: { kind: "icon", value: "Search" },
      sections: [
        {
          heading:
            "projectTemplates:content.analytics-request-desk.pages.reviewChecklist.question",
          starter:
            "projectTemplates:content.analytics-request-desk.pages.reviewChecklist.questionStarter",
        },
        {
          heading:
            "projectTemplates:content.analytics-request-desk.pages.reviewChecklist.method",
          starter:
            "projectTemplates:content.analytics-request-desk.pages.reviewChecklist.methodStarter",
        },
        {
          heading:
            "projectTemplates:content.analytics-request-desk.pages.reviewChecklist.numbers",
          starter:
            "projectTemplates:content.analytics-request-desk.pages.reviewChecklist.numbersStarter",
        },
        {
          heading:
            "projectTemplates:content.analytics-request-desk.pages.reviewChecklist.caveats",
          starter:
            "projectTemplates:content.analytics-request-desk.pages.reviewChecklist.caveatsStarter",
        },
      ],
    },
  ],

  sample: {
    tasks: [
      {
        key: "signups",
        title:
          "projectTemplates:content.analytics-request-desk.samples.signups",
        column: "delivered",
        priority: "low",
        labels: ["recurring-ask"],
        dueInDays: -6,
        estimateValue: "1",
        customFields: {
          "request-type": "quick-question",
          decision:
            "projectTemplates:content.analytics-request-desk.samples.signupsDecision",
          "decision-size": "one-team",
        },
      },
      {
        key: "sales-dashboard",
        title:
          "projectTemplates:content.analytics-request-desk.samples.salesDashboard",
        column: "in-progress",
        priority: "medium",
        assignee: "creator",
        startInDays: -2,
        dueInDays: 6,
        estimateValue: "5",
        customFields: {
          "request-type": "report-or-dashboard",
          decision:
            "projectTemplates:content.analytics-request-desk.samples.salesDashboardDecision",
          "decision-size": "one-department",
        },
      },
      {
        key: "cancellations",
        title:
          "projectTemplates:content.analytics-request-desk.samples.cancellations",
        description:
          "projectTemplates:content.analytics-request-desk.samples.cancellationsDescription",
        column: "in-review",
        priority: "high",
        assignee: "creator",
        startInDays: -5,
        dueInDays: 2,
        estimateValue: "8",
        customFields: {
          "request-type": "deep-dive",
          decision:
            "projectTemplates:content.analytics-request-desk.samples.cancellationsDecision",
          "decision-size": "whole-organisation",
        },
      },
      {
        key: "survey-list",
        title:
          "projectTemplates:content.analytics-request-desk.samples.surveyList",
        description:
          "projectTemplates:content.analytics-request-desk.samples.surveyListDescription",
        column: "waiting-on-requester",
        priority: "low",
        dueInDays: 9,
        customFields: {
          "request-type": "data-pull",
          "decision-size": "one-team",
        },
      },
      {
        key: "revenue-mismatch",
        title:
          "projectTemplates:content.analytics-request-desk.samples.revenueMismatch",
        description:
          "projectTemplates:content.analytics-request-desk.samples.revenueMismatchDescription",
        column: "up-next",
        priority: "high",
        labels: ["data-quality"],
        dueInDays: 3,
        customFields: {
          "request-type": "check-a-number",
          "decision-size": "whole-organisation",
        },
      },
    ],
  },
};

export default template;
