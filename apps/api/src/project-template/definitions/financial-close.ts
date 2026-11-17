import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/financial-close.md

const P = "projectTemplates:content.financial-close";

// Every close step repeats on its own day of the month. The schedule trigger
// creates next month's copy on that date even while this month's is open.
const monthlyOn = (monthDay: number) =>
  ({ frequency: "monthly", monthDay, trigger: "schedule" }) as const;

const template: ProjectTemplate = {
  id: "financial-close",
  version: 1,
  categories: ["finance", "work-management"],
  icon: "Calendar",
  name: "projectTemplates:catalog.financial-close.name",
  pitch: "projectTemplates:catalog.financial-close.pitch",
  description: "projectTemplates:catalog.financial-close.description",
  suggestedKey: "CLOSE",

  project: {
    description: `${P}.projectDescription`,
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
      key: "todo",
      name: "projectTemplates:common.statuses.todo",
      group: "unstarted",
    },
    {
      key: "in-progress",
      name: "projectTemplates:common.statuses.inProgress",
      group: "started",
    },
    {
      key: "ready-for-review",
      name: `${P}.statuses.readyForReview`,
      group: "started",
    },
    {
      key: "reviewed",
      name: `${P}.statuses.reviewed`,
      group: "completed",
    },
    {
      key: "not-needed",
      name: `${P}.statuses.notNeeded`,
      group: "cancelled",
    },
  ],

  labels: [
    { key: "pre-close", name: `${P}.labels.preClose`, color: "dark-gray" },
    {
      key: "reconciliation",
      name: `${P}.labels.reconciliation`,
      color: "teal",
    },
    {
      key: "journal-entry",
      name: `${P}.labels.journalEntry`,
      color: "purple",
    },
    { key: "reporting", name: `${P}.labels.reporting`, color: "green" },
  ],

  customFields: [
    {
      key: "close-day",
      name: `${P}.fields.closeDay`,
      type: "dropdown",
      options: [
        { key: "before-close", label: `${P}.options.closeDay.beforeClose` },
        { key: "day-1", label: `${P}.options.closeDay.day1` },
        { key: "day-2", label: `${P}.options.closeDay.day2` },
        { key: "day-3", label: `${P}.options.closeDay.day3` },
        { key: "day-4", label: `${P}.options.closeDay.day4` },
        { key: "day-5", label: `${P}.options.closeDay.day5` },
      ],
    },
    { key: "reviewer", name: `${P}.fields.reviewer`, type: "text" },
  ],

  views: [
    {
      name: `${P}.views.closeBoard`,
      description: `${P}.views.closeBoardDescription`,
      filters: {
        // The current close, including pre-close steps dated late last month.
        root: {
          op: "or",
          children: [
            {
              key: "dueDate",
              operator: "withinLast",
              amount: 30,
              unit: "days",
            },
            { key: "dueDate", operator: "withinNext", amount: 7, unit: "days" },
          ],
        },
      },
      display: {
        layout: "board",
        groupBy: { customField: "close-day" },
        subGroupBy: "status",
        orderBy: { field: "dueDate", direction: "asc" },
      },
      displayProperties: { customFields: ["close-day", "reviewer"] },
    },
    {
      name: `${P}.views.waitingForReview`,
      filters: {
        root: { key: "status", operator: "in", columns: ["ready-for-review"] },
      },
      display: {
        layout: "list",
        groupBy: null,
        orderBy: { field: "dueDate", direction: "asc" },
      },
      displayProperties: { customFields: ["reviewer"] },
    },
    {
      name: `${P}.views.openThisMonth`,
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
        groupBy: "assignee",
        orderBy: { field: "dueDate", direction: "asc" },
      },
    },
  ],

  taskTemplates: [
    {
      name: `${P}.taskTemplates.accountReconciliation.name`,
      description: `${P}.taskTemplates.accountReconciliation.description`,
      priority: "high",
      labels: ["reconciliation"],
    },
    {
      name: `${P}.taskTemplates.journalEntry.name`,
      description: `${P}.taskTemplates.journalEntry.description`,
      priority: "medium",
      labels: ["journal-entry"],
    },
  ],

  automationRules: [
    {
      name: `${P}.rules.readyForReview`,
      trigger: { type: "status_changed", to: ["ready-for-review"] },
      actions: [
        {
          type: "notify",
          roles: ["lead"],
          message: `${P}.rules.readyForReviewMessage`,
        },
        { type: "add_comment", template: `${P}.rules.reviewerComment` },
      ],
    },
    {
      name: `${P}.rules.overdue`,
      trigger: { type: "due_date_passed" },
      actions: [
        { type: "set_priority", priority: "urgent" },
        {
          type: "notify",
          roles: ["assignees", "lead"],
          message: `${P}.rules.overdueMessage`,
        },
      ],
    },
  ],

  pages: [
    {
      key: "close-calendar",
      title: `${P}.pages.closeCalendar.title`,
      logo: { kind: "icon", value: "Calendar" },
      sections: [
        {
          heading: `${P}.pages.closeCalendar.dayPlan`,
          starter: `${P}.pages.closeCalendar.dayPlanStarter`,
        },
        {
          heading: `${P}.pages.closeCalendar.cutoffs`,
          starter: `${P}.pages.closeCalendar.cutoffsStarter`,
        },
        {
          heading: "projectTemplates:common.pages.roles",
          starter: `${P}.pages.closeCalendar.rolesStarter`,
        },
        {
          heading: `${P}.pages.closeCalendar.materiality`,
          starter: `${P}.pages.closeCalendar.materialityStarter`,
        },
        {
          heading: `${P}.pages.closeCalendar.signOff`,
          starter: `${P}.pages.closeCalendar.signOffStarter`,
        },
      ],
    },
  ],

  sample: {
    tasks: [
      {
        key: "cutoff",
        title: `${P}.samples.cutoff`,
        column: "todo",
        priority: "high",
        labels: ["pre-close"],
        customFields: { "close-day": "before-close" },
        dueInDays: 0,
        recurrence: monthlyOn(28),
      },
      {
        key: "bank-rec",
        title: `${P}.samples.bankRec`,
        description: `${P}.samples.bankRecDescription`,
        column: "todo",
        priority: "high",
        labels: ["reconciliation"],
        assignee: "creator",
        customFields: { "close-day": "day-1" },
        dueInDays: 1,
        recurrence: monthlyOn(2),
      },
      {
        key: "depreciation",
        title: `${P}.samples.depreciation`,
        column: "todo",
        priority: "medium",
        labels: ["journal-entry"],
        customFields: { "close-day": "day-1" },
        dueInDays: 1,
        recurrence: monthlyOn(2),
      },
      {
        key: "accruals",
        title: `${P}.samples.accruals`,
        description: `${P}.samples.accrualsDescription`,
        column: "todo",
        priority: "high",
        labels: ["journal-entry"],
        customFields: { "close-day": "day-2" },
        dueInDays: 2,
        recurrence: monthlyOn(3),
      },
      {
        key: "payroll",
        title: `${P}.samples.payroll`,
        column: "todo",
        priority: "high",
        labels: ["reconciliation"],
        customFields: { "close-day": "day-2" },
        dueInDays: 2,
        recurrence: monthlyOn(3),
      },
      {
        key: "receivables",
        title: `${P}.samples.receivables`,
        column: "todo",
        priority: "medium",
        labels: ["reconciliation"],
        customFields: { "close-day": "day-3" },
        dueInDays: 3,
        recurrence: monthlyOn(4),
      },
      {
        key: "variances",
        title: `${P}.samples.variances`,
        description: `${P}.samples.variancesDescription`,
        column: "todo",
        priority: "high",
        labels: ["reporting"],
        customFields: { "close-day": "day-4" },
        dueInDays: 4,
        recurrence: monthlyOn(5),
      },
      {
        key: "sign-off",
        title: `${P}.samples.signOff`,
        description: `${P}.samples.signOffDescription`,
        column: "todo",
        priority: "urgent",
        labels: ["reporting"],
        assignee: "creator",
        customFields: { "close-day": "day-5" },
        dueInDays: 5,
        recurrence: monthlyOn(6),
      },
    ],
  },
};

export default template;
