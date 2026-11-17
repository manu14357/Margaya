import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/it-service-desk.md

const OPEN = ["unstarted", "started"] as const;

const template: ProjectTemplate = {
  id: "it-service-desk",
  version: 1,
  categories: ["service-management", "it"],
  icon: "Cog",
  name: "projectTemplates:catalog.it-service-desk.name",
  pitch: "projectTemplates:catalog.it-service-desk.pitch",
  description: "projectTemplates:catalog.it-service-desk.description",
  suggestedKey: "IT",

  project: {
    description: "projectTemplates:content.it-service-desk.projectDescription",
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
      key: "recurring",
      name: "projectTemplates:common.labels.recurring",
      color: "orange",
    },
    {
      key: "waiting-on-supplier",
      name: "projectTemplates:content.it-service-desk.labels.waitingOnSupplier",
      color: "yellow",
    },
    {
      key: "change",
      name: "projectTemplates:common.labels.change",
      color: "purple",
    },
  ],

  customFields: [
    {
      key: "request-type",
      name: "projectTemplates:common.fields.requestType",
      type: "dropdown",
      options: [
        {
          key: "broken",
          label:
            "projectTemplates:content.it-service-desk.options.requestType.broken",
        },
        {
          key: "access",
          label:
            "projectTemplates:content.it-service-desk.options.requestType.access",
        },
        {
          key: "device",
          label:
            "projectTemplates:content.it-service-desk.options.requestType.device",
        },
        {
          key: "small-change",
          label:
            "projectTemplates:content.it-service-desk.options.requestType.smallChange",
        },
        { key: "question", label: "projectTemplates:common.options.question" },
      ],
      defaultOption: "question",
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
          key: "slowed",
          label: "projectTemplates:common.options.workIsSlowed",
        },
        {
          key: "stopped",
          label: "projectTemplates:common.options.workIsStopped",
        },
      ],
    },
    {
      key: "asset-tag",
      name: "projectTemplates:content.it-service-desk.fields.assetTag",
      type: "text",
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
        "projectTemplates:content.it-service-desk.views.breachingSoonDescription",
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
  ],

  taskTemplates: [
    {
      name: "projectTemplates:content.it-service-desk.taskTemplates.signIn.name",
      description:
        "projectTemplates:content.it-service-desk.taskTemplates.signIn.description",
      priority: "medium",
    },
    {
      name: "projectTemplates:content.it-service-desk.taskTemplates.access.name",
      description:
        "projectTemplates:content.it-service-desk.taskTemplates.access.description",
      priority: "low",
    },
    {
      name: "projectTemplates:content.it-service-desk.taskTemplates.newStarter.name",
      description:
        "projectTemplates:content.it-service-desk.taskTemplates.newStarter.description",
      priority: "medium",
      subtasks: [
        "projectTemplates:content.it-service-desk.subtasks.prepareLaptop",
        "projectTemplates:content.it-service-desk.subtasks.createAccounts",
        "projectTemplates:content.it-service-desk.subtasks.addToGroups",
        "projectTemplates:content.it-service-desk.subtasks.secondStep",
        "projectTemplates:content.it-service-desk.subtasks.handOver",
      ],
    },
    {
      name: "projectTemplates:content.it-service-desk.taskTemplates.software.name",
      description:
        "projectTemplates:content.it-service-desk.taskTemplates.software.description",
      priority: "low",
    },
    {
      name: "projectTemplates:content.it-service-desk.taskTemplates.smallChange.name",
      description:
        "projectTemplates:content.it-service-desk.taskTemplates.smallChange.description",
      priority: "medium",
      labels: ["change"],
    },
  ],

  automationRules: [
    {
      name: "projectTemplates:content.it-service-desk.rules.targetUrgent",
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
            "projectTemplates:content.it-service-desk.rules.urgentMessage",
        },
      ],
    },
    {
      name: "projectTemplates:content.it-service-desk.rules.targetHigh",
      trigger: { type: "task_created", fromIntake: true },
      conditions: {
        op: "and",
        conditions: [{ field: "priority", op: "is", values: ["high"] }],
      },
      actions: [{ type: "set_due_date", offsetDays: 1 }],
    },
    {
      name: "projectTemplates:content.it-service-desk.rules.targetMedium",
      trigger: { type: "task_created", fromIntake: true },
      conditions: {
        op: "and",
        conditions: [{ field: "priority", op: "is", values: ["medium"] }],
      },
      actions: [{ type: "set_due_date", offsetDays: 3 }],
    },
    {
      name: "projectTemplates:content.it-service-desk.rules.targetLow",
      trigger: { type: "task_created", fromIntake: true },
      conditions: {
        op: "and",
        conditions: [{ field: "priority", op: "is", values: ["low"] }],
      },
      actions: [{ type: "set_due_date", offsetDays: 5 }],
    },
    {
      name: "projectTemplates:content.it-service-desk.rules.lateOwner",
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
          message: "projectTemplates:content.it-service-desk.rules.lateMessage",
        },
      ],
    },
  ],

  scheduledAutomations: { autoArchive: { enabled: true, months: 3 } },

  intakeForm: {
    title: "projectTemplates:content.it-service-desk.form.title",
    intro: "projectTemplates:content.it-service-desk.form.intro",
    descriptionField: "optional",
    emailField: "required",
    nameField: "required",
    customFields: ["request-type", "impact", "urgency", "asset-tag"],
    confirmationMessage:
      "projectTemplates:content.it-service-desk.form.confirmation",
  },

  pages: [
    {
      key: "get-help",
      title: "projectTemplates:content.it-service-desk.pages.getHelp.title",
      logo: { kind: "icon", value: "MessageSquare" },
      sections: [
        {
          heading:
            "projectTemplates:content.it-service-desk.pages.getHelp.where",
          starter:
            "projectTemplates:content.it-service-desk.pages.getHelp.whereStarter",
        },
        {
          heading: "projectTemplates:common.pages.whatToInclude",
          starter:
            "projectTemplates:content.it-service-desk.pages.getHelp.includeStarter",
        },
        {
          heading:
            "projectTemplates:content.it-service-desk.pages.getHelp.urgent",
          starter:
            "projectTemplates:content.it-service-desk.pages.getHelp.urgentStarter",
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
            "projectTemplates:content.it-service-desk.pages.knowledgeBase.howToAdd",
          starter:
            "projectTemplates:content.it-service-desk.pages.knowledgeBase.howToAddStarter",
        },
        {
          heading:
            "projectTemplates:content.it-service-desk.pages.knowledgeBase.printing",
          starter:
            "projectTemplates:content.it-service-desk.pages.knowledgeBase.entryStarter",
        },
        {
          heading:
            "projectTemplates:content.it-service-desk.pages.knowledgeBase.wireless",
          starter:
            "projectTemplates:content.it-service-desk.pages.knowledgeBase.entryStarter",
        },
        {
          heading:
            "projectTemplates:content.it-service-desk.pages.knowledgeBase.videoCalls",
          starter:
            "projectTemplates:content.it-service-desk.pages.knowledgeBase.entryStarter",
        },
        {
          heading:
            "projectTemplates:content.it-service-desk.pages.knowledgeBase.passwordReset",
          starter:
            "projectTemplates:content.it-service-desk.pages.knowledgeBase.entryStarter",
        },
        {
          heading:
            "projectTemplates:content.it-service-desk.pages.knowledgeBase.sharedFolders",
          starter:
            "projectTemplates:content.it-service-desk.pages.knowledgeBase.entryStarter",
        },
      ],
    },
    {
      key: "change-checklist",
      title:
        "projectTemplates:content.it-service-desk.pages.changeChecklist.title",
      logo: { kind: "icon", value: "List" },
      sections: [
        {
          heading:
            "projectTemplates:content.it-service-desk.pages.changeChecklist.before",
          starter:
            "projectTemplates:content.it-service-desk.pages.changeChecklist.beforeStarter",
        },
        {
          heading: "projectTemplates:common.pages.steps",
          starter: "1.",
        },
        {
          heading:
            "projectTemplates:content.it-service-desk.pages.changeChecklist.undo",
          starter:
            "projectTemplates:content.it-service-desk.pages.changeChecklist.undoStarter",
        },
        {
          heading:
            "projectTemplates:content.it-service-desk.pages.changeChecklist.after",
          starter:
            "projectTemplates:content.it-service-desk.pages.changeChecklist.afterStarter",
        },
      ],
    },
  ],

  sample: {
    tasks: [
      {
        key: "printer",
        title: "projectTemplates:content.it-service-desk.samples.printer",
        description:
          "projectTemplates:content.it-service-desk.samples.printerDescription",
        column: "in-progress",
        priority: "medium",
        labels: ["recurring"],
        assignee: "creator",
        startInDays: -1,
        dueInDays: 2,
        customFields: {
          "request-type": "broken",
          impact: "my-team",
          urgency: "slowed",
        },
      },
      {
        key: "sales-folder",
        title: "projectTemplates:content.it-service-desk.samples.salesFolder",
        description:
          "projectTemplates:content.it-service-desk.samples.salesFolderDescription",
        column: "new",
        priority: "low",
        dueInDays: 5,
        customFields: {
          "request-type": "access",
          impact: "just-me",
          urgency: "can-wait",
        },
      },
      {
        key: "new-starter",
        title: "projectTemplates:content.it-service-desk.samples.newStarter",
        description:
          "projectTemplates:content.it-service-desk.samples.newStarterDescription",
        column: "in-progress",
        priority: "medium",
        assignee: "creator",
        startInDays: 0,
        dueInDays: 3,
        customFields: { "request-type": "device" },
        subtasks: [
          "projectTemplates:content.it-service-desk.subtasks.prepareLaptop",
          "projectTemplates:content.it-service-desk.subtasks.createAccounts",
        ],
      },
      {
        key: "wireless",
        title: "projectTemplates:content.it-service-desk.samples.wireless",
        description:
          "projectTemplates:content.it-service-desk.samples.wirelessDescription",
        column: "waiting-on-requester",
        priority: "high",
        dueInDays: 1,
        customFields: {
          "request-type": "broken",
          impact: "many",
          urgency: "slowed",
        },
      },
      {
        key: "charger",
        title: "projectTemplates:content.it-service-desk.samples.charger",
        column: "resolved",
        priority: "low",
        labels: ["waiting-on-supplier"],
        customFields: {
          "request-type": "device",
          impact: "just-me",
          urgency: "can-wait",
        },
      },
      {
        key: "guest-wireless",
        title: "projectTemplates:content.it-service-desk.samples.guestWireless",
        description:
          "projectTemplates:content.it-service-desk.samples.guestWirelessDescription",
        column: "new",
        priority: "medium",
        labels: ["change"],
        startInDays: 2,
        dueInDays: 2,
        customFields: {
          "request-type": "small-change",
          impact: "many",
          urgency: "can-wait",
        },
      },
    ],
  },
};

export default template;
