import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/general-service-desk.md

const OPEN = ["unstarted", "started"] as const;

const template: ProjectTemplate = {
  id: "general-service-desk",
  version: 1,
  categories: ["service-management", "it"],
  icon: "MessageSquare",
  name: "projectTemplates:catalog.general-service-desk.name",
  pitch: "projectTemplates:catalog.general-service-desk.pitch",
  description: "projectTemplates:catalog.general-service-desk.description",
  suggestedKey: "DESK",

  project: {
    description:
      "projectTemplates:content.general-service-desk.projectDescription",
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
      key: "waiting-on-requester",
      name: "projectTemplates:common.statuses.waitingOnRequester",
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
      key: "needs-another-team",
      name: "projectTemplates:common.labels.needsAnotherTeam",
      color: "yellow",
    },
    {
      key: "repeat-question",
      name: "projectTemplates:content.general-service-desk.labels.repeatQuestion",
      color: "dark-gray",
    },
  ],

  customFields: [
    {
      key: "request-type",
      name: "projectTemplates:common.fields.requestType",
      type: "dropdown",
      options: [
        { key: "question", label: "projectTemplates:common.options.question" },
        {
          key: "not-working",
          label:
            "projectTemplates:content.general-service-desk.options.requestType.notWorking",
        },
        {
          key: "need-something",
          label:
            "projectTemplates:content.general-service-desk.options.requestType.needSomething",
        },
        { key: "feedback", label: "projectTemplates:common.options.feedback" },
        { key: "other", label: "projectTemplates:common.options.other" },
      ],
      defaultOption: "other",
    },
    {
      key: "impact",
      name: "projectTemplates:common.fields.impact",
      type: "dropdown",
      options: [
        { key: "just-me", label: "projectTemplates:common.options.justMe" },
        { key: "my-team", label: "projectTemplates:common.options.myTeam" },
        { key: "many", label: "projectTemplates:common.options.manyPeople" },
      ],
    },
    {
      key: "urgency",
      name: "projectTemplates:common.fields.urgency",
      type: "dropdown",
      options: [
        { key: "can-wait", label: "projectTemplates:common.options.itCanWait" },
        {
          key: "this-week",
          label:
            "projectTemplates:content.general-service-desk.options.urgency.thisWeek",
        },
        {
          key: "stopped",
          label: "projectTemplates:common.options.workIsStopped",
        },
      ],
    },
    {
      key: "team",
      name: "projectTemplates:common.fields.team",
      type: "dropdown",
      options: [
        {
          key: "it",
          label:
            "projectTemplates:content.general-service-desk.options.team.it",
        },
        { key: "people", label: "projectTemplates:common.options.people" },
        { key: "finance", label: "projectTemplates:common.options.finance" },
        {
          key: "facilities",
          label:
            "projectTemplates:content.general-service-desk.options.team.facilities",
        },
        {
          key: "operations",
          label: "projectTemplates:common.options.operations",
        },
        { key: "other", label: "projectTemplates:common.options.other" },
      ],
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
        "projectTemplates:content.general-service-desk.views.breachingSoonDescription",
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
      name: "projectTemplates:common.views.byTeam",
      filters: {
        root: { key: "group", operator: "in", values: OPEN },
      },
      display: {
        layout: "board",
        groupBy: { customField: "team" },
        orderBy: { field: "priority" },
      },
    },
  ],

  taskTemplates: [
    {
      name: "projectTemplates:content.general-service-desk.taskTemplates.walkUp.name",
      description:
        "projectTemplates:content.general-service-desk.taskTemplates.walkUp.description",
      priority: "no-priority",
    },
    {
      name: "projectTemplates:content.general-service-desk.taskTemplates.question.name",
      description:
        "projectTemplates:content.general-service-desk.taskTemplates.question.description",
      priority: "low",
    },
    {
      name: "projectTemplates:content.general-service-desk.taskTemplates.notWorking.name",
      description:
        "projectTemplates:content.general-service-desk.taskTemplates.notWorking.description",
      priority: "medium",
    },
    {
      name: "projectTemplates:content.general-service-desk.taskTemplates.handOver.name",
      description:
        "projectTemplates:content.general-service-desk.taskTemplates.handOver.description",
      priority: "no-priority",
      labels: ["needs-another-team"],
    },
  ],

  automationRules: [
    {
      name: "projectTemplates:content.general-service-desk.rules.targetUrgent",
      trigger: { type: "task_created", fromIntake: true },
      conditions: {
        op: "and",
        conditions: [{ field: "priority", op: "is", values: ["urgent"] }],
      },
      actions: [{ type: "set_due_date", offsetDays: 0 }],
    },
    {
      name: "projectTemplates:content.general-service-desk.rules.targetHigh",
      trigger: { type: "task_created", fromIntake: true },
      conditions: {
        op: "and",
        conditions: [{ field: "priority", op: "is", values: ["high"] }],
      },
      actions: [{ type: "set_due_date", offsetDays: 1 }],
    },
    {
      name: "projectTemplates:content.general-service-desk.rules.targetMedium",
      trigger: { type: "task_created", fromIntake: true },
      conditions: {
        op: "and",
        conditions: [{ field: "priority", op: "is", values: ["medium"] }],
      },
      actions: [{ type: "set_due_date", offsetDays: 3 }],
    },
    {
      name: "projectTemplates:content.general-service-desk.rules.targetLow",
      trigger: { type: "task_created", fromIntake: true },
      conditions: {
        op: "and",
        conditions: [{ field: "priority", op: "is", values: ["low"] }],
      },
      actions: [{ type: "set_due_date", offsetDays: 7 }],
    },
    {
      name: "projectTemplates:content.general-service-desk.rules.lateOwner",
      trigger: { type: "due_date_passed" },
      // Closed requests keep their due date; nobody needs to hear about those.
      conditions: {
        op: "and",
        conditions: [
          { field: "status", op: "is_not", columns: ["resolved", "wont-do"] },
        ],
      },
      actions: [
        {
          type: "notify",
          roles: ["assignees", "lead"],
          message:
            "projectTemplates:content.general-service-desk.rules.lateMessage",
        },
      ],
    },
  ],

  scheduledAutomations: { autoArchive: { enabled: true, months: 3 } },

  intakeForm: {
    title: "projectTemplates:content.general-service-desk.form.title",
    intro: "projectTemplates:content.general-service-desk.form.intro",
    descriptionField: "optional",
    emailField: "required",
    nameField: "optional",
    customFields: ["request-type", "impact", "urgency"],
    confirmationMessage:
      "projectTemplates:content.general-service-desk.form.confirmation",
  },

  pages: [
    {
      key: "how-to-ask",
      title:
        "projectTemplates:content.general-service-desk.pages.howToAsk.title",
      logo: { kind: "icon", value: "MessageSquare" },
      sections: [
        {
          heading:
            "projectTemplates:content.general-service-desk.pages.howToAsk.where",
          starter:
            "projectTemplates:content.general-service-desk.pages.howToAsk.whereStarter",
        },
        {
          heading: "projectTemplates:common.pages.whatToInclude",
          starter:
            "projectTemplates:content.general-service-desk.pages.howToAsk.includeStarter",
        },
        {
          heading: "projectTemplates:common.pages.whatHappensNext",
          starter:
            "projectTemplates:content.general-service-desk.pages.howToAsk.nextStarter",
        },
        {
          heading:
            "projectTemplates:content.general-service-desk.pages.howToAsk.responseTimes",
          starter:
            "projectTemplates:content.general-service-desk.pages.howToAsk.responseTimesStarter",
        },
      ],
    },
    {
      key: "knowledge-base",
      title: "projectTemplates:common.pages.knowledgeBase",
      logo: { kind: "icon", value: "BookOpen" },
      sections: [
        {
          heading:
            "projectTemplates:content.general-service-desk.pages.knowledgeBase.howToAdd",
          starter:
            "projectTemplates:content.general-service-desk.pages.knowledgeBase.howToAddStarter",
        },
        {
          heading:
            "projectTemplates:content.general-service-desk.pages.knowledgeBase.exampleQuestion",
          starter:
            "projectTemplates:content.general-service-desk.pages.knowledgeBase.exampleAnswer",
        },
      ],
    },
    {
      key: "triage-guide",
      title:
        "projectTemplates:content.general-service-desk.pages.triageGuide.title",
      logo: { kind: "icon", value: "List" },
      sections: [
        {
          heading:
            "projectTemplates:content.general-service-desk.pages.triageGuide.priority",
          starter:
            "projectTemplates:content.general-service-desk.pages.triageGuide.priorityStarter",
        },
        {
          heading:
            "projectTemplates:content.general-service-desk.pages.triageGuide.targets",
          starter:
            "projectTemplates:content.general-service-desk.pages.triageGuide.targetsStarter",
        },
        {
          heading:
            "projectTemplates:content.general-service-desk.pages.triageGuide.decline",
          starter:
            "projectTemplates:content.general-service-desk.pages.triageGuide.declineStarter",
        },
        {
          heading:
            "projectTemplates:content.general-service-desk.pages.triageGuide.handOver",
          starter:
            "projectTemplates:content.general-service-desk.pages.triageGuide.handOverStarter",
        },
      ],
    },
  ],

  sample: {
    tasks: [
      {
        key: "projector",
        title:
          "projectTemplates:content.general-service-desk.samples.projector",
        description:
          "projectTemplates:content.general-service-desk.samples.projectorDescription",
        column: "new",
        priority: "medium",
        dueInDays: 3,
        customFields: {
          "request-type": "not-working",
          impact: "my-team",
          urgency: "this-week",
          team: "facilities",
        },
      },
      {
        key: "bank-details",
        title:
          "projectTemplates:content.general-service-desk.samples.bankDetails",
        column: "in-progress",
        priority: "low",
        labels: ["repeat-question"],
        dueInDays: 5,
        customFields: {
          "request-type": "question",
          impact: "just-me",
          urgency: "this-week",
          team: "people",
        },
      },
      {
        key: "shared-drive",
        title:
          "projectTemplates:content.general-service-desk.samples.sharedDrive",
        description:
          "projectTemplates:content.general-service-desk.samples.sharedDriveDescription",
        column: "in-progress",
        priority: "high",
        assignee: "creator",
        startInDays: 0,
        dueInDays: 1,
        customFields: {
          "request-type": "not-working",
          impact: "my-team",
          urgency: "stopped",
          team: "it",
        },
      },
      {
        key: "standing-desk",
        title:
          "projectTemplates:content.general-service-desk.samples.standingDesk",
        description:
          "projectTemplates:content.general-service-desk.samples.standingDeskDescription",
        column: "waiting-on-requester",
        priority: "low",
        dueInDays: 6,
        customFields: {
          "request-type": "need-something",
          impact: "just-me",
          urgency: "can-wait",
          team: "facilities",
        },
      },
      {
        key: "conference-ticket",
        title:
          "projectTemplates:content.general-service-desk.samples.conferenceTicket",
        column: "resolved",
        priority: "low",
        labels: ["needs-another-team"],
        customFields: {
          "request-type": "need-something",
          impact: "just-me",
          team: "finance",
        },
      },
      {
        key: "lunch-slot",
        title:
          "projectTemplates:content.general-service-desk.samples.lunchSlot",
        column: "wont-do",
        priority: "no-priority",
        customFields: { "request-type": "feedback", team: "operations" },
      },
    ],
  },
};

export default template;
