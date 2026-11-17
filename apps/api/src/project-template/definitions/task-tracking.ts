import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/task-tracking.md

const template: ProjectTemplate = {
  id: "task-tracking",
  version: 1,
  categories: ["work-management", "customer-service", "personal"],
  icon: "List",
  name: "projectTemplates:catalog.task-tracking.name",
  pitch: "projectTemplates:catalog.task-tracking.pitch",
  description: "projectTemplates:catalog.task-tracking.description",
  suggestedKey: "TASK",

  project: {
    description: "projectTemplates:content.task-tracking.projectDescription",
    features: {
      cycles: false,
      modules: false,
      views: true,
      pages: false,
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
      key: "doing",
      name: "projectTemplates:content.task-tracking.statuses.doing",
      group: "started",
    },
    {
      key: "waiting",
      name: "projectTemplates:common.statuses.waiting",
      group: "started",
    },
    {
      key: "done",
      name: "projectTemplates:common.statuses.done",
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
      key: "quick-win",
      name: "projectTemplates:common.labels.quickWin",
      color: "green",
    },
    {
      key: "follow-up",
      name: "projectTemplates:common.labels.followUp",
      color: "purple",
    },
  ],

  views: [
    {
      name: "projectTemplates:content.task-tracking.views.myTasks",
      filters: {
        root: {
          op: "and",
          children: [
            { key: "assignee", operator: "in", values: ["me"] },
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
        orderBy: { field: "dueDate", direction: "asc" },
      },
    },
    {
      // The plan says "not completed"; cancelled work needs no push either.
      name: "projectTemplates:common.views.dueThisWeek",
      filters: {
        root: {
          op: "and",
          children: [
            { key: "dueDate", operator: "in", values: ["thisWeek"] },
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
    {
      name: "projectTemplates:common.views.calendar",
      filters: {
        root: { key: "group", operator: "notIn", values: ["cancelled"] },
      },
      display: { layout: "calendar", groupBy: null },
    },
  ],

  taskTemplates: [
    {
      name: "projectTemplates:content.task-tracking.taskTemplates.followUp.name",
      description:
        "projectTemplates:content.task-tracking.taskTemplates.followUp.description",
      priority: "medium",
      labels: ["follow-up"],
    },
  ],

  automationRules: [
    {
      name: "projectTemplates:content.task-tracking.rules.overdue",
      trigger: { type: "due_date_passed" },
      // Setting "high" would lower an urgent task, so urgent work is left as is.
      conditions: {
        op: "and",
        conditions: [{ field: "priority", op: "is_not", values: ["urgent"] }],
      },
      actions: [
        { type: "set_priority", priority: "high" },
        {
          type: "notify",
          roles: ["assignees"],
          message:
            "projectTemplates:content.task-tracking.rules.overdueMessage",
        },
      ],
    },
  ],

  sample: {
    tasks: [
      {
        key: "chairs",
        title: "projectTemplates:content.task-tracking.samples.chairs",
        column: "todo",
        priority: "low",
        labels: ["quick-win"],
        dueInDays: 10,
      },
      {
        key: "contact-sheet",
        title: "projectTemplates:content.task-tracking.samples.contactSheet",
        column: "doing",
        priority: "medium",
        assignee: "creator",
        startInDays: -1,
        dueInDays: 2,
      },
      {
        key: "signed-quote",
        title: "projectTemplates:content.task-tracking.samples.signedQuote",
        description:
          "projectTemplates:content.task-tracking.samples.signedQuoteDescription",
        column: "waiting",
        priority: "medium",
        labels: ["follow-up"],
        dueInDays: 3,
      },
      {
        key: "venue",
        title: "projectTemplates:content.task-tracking.samples.venue",
        description:
          "projectTemplates:content.task-tracking.samples.venueDescription",
        column: "todo",
        priority: "high",
        assignee: "creator",
        dueInDays: 5,
      },
      {
        key: "meeting-notes",
        title: "projectTemplates:content.task-tracking.samples.meetingNotes",
        column: "done",
        priority: "low",
        labels: ["quick-win"],
        dueInDays: -1,
      },
    ],
  },
};

export default template;
