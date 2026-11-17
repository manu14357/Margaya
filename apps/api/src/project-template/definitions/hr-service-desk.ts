import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/hr-service-desk.md

const OPEN = ["unstarted", "started"] as const;

const template: ProjectTemplate = {
  id: "hr-service-desk",
  version: 1,
  categories: ["service-management", "human-resources"],
  icon: "Users",
  name: "projectTemplates:catalog.hr-service-desk.name",
  pitch: "projectTemplates:catalog.hr-service-desk.pitch",
  description: "projectTemplates:catalog.hr-service-desk.description",
  suggestedKey: "HR",
  // People requests hold personal data: only HR members (plus workspace
  // owners and admins) should see them.
  suggestedVisibility: "restricted",

  project: {
    description: "projectTemplates:content.hr-service-desk.projectDescription",
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
      key: "waiting-on-employee",
      name: "projectTemplates:content.hr-service-desk.statuses.waitingOnEmployee",
      group: "started",
    },
    {
      key: "resolved",
      name: "projectTemplates:common.statuses.resolved",
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
      key: "sensitive",
      name: "projectTemplates:content.hr-service-desk.labels.sensitive",
      color: "red",
    },
    {
      key: "policy-gap",
      name: "projectTemplates:content.hr-service-desk.labels.policyGap",
      color: "dark-gray",
    },
  ],

  customFields: [
    {
      key: "request-type",
      name: "projectTemplates:common.fields.requestType",
      type: "dropdown",
      options: [
        {
          key: "new-starter",
          label:
            "projectTemplates:content.hr-service-desk.options.requestType.newStarter",
        },
        {
          key: "leaver",
          label:
            "projectTemplates:content.hr-service-desk.options.requestType.leaver",
        },
        {
          key: "time-off",
          label:
            "projectTemplates:content.hr-service-desk.options.requestType.timeOff",
        },
        {
          key: "pay",
          label:
            "projectTemplates:content.hr-service-desk.options.requestType.pay",
        },
        {
          key: "policy",
          label:
            "projectTemplates:content.hr-service-desk.options.requestType.policy",
        },
        {
          key: "concern",
          label:
            "projectTemplates:content.hr-service-desk.options.requestType.concern",
        },
        {
          key: "details",
          label:
            "projectTemplates:content.hr-service-desk.options.requestType.details",
        },
        { key: "other", label: "projectTemplates:common.options.other" },
      ],
      defaultOption: "other",
    },
    {
      key: "key-date",
      name: "projectTemplates:content.hr-service-desk.fields.keyDate",
      type: "date",
    },
    {
      key: "sensitive",
      name: "projectTemplates:content.hr-service-desk.fields.sensitive",
      type: "boolean",
    },
  ],

  views: [
    {
      name: "projectTemplates:content.hr-service-desk.views.myCases",
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
        "projectTemplates:content.hr-service-desk.views.breachingSoonDescription",
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
                  amount: 2,
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
      name: "projectTemplates:content.hr-service-desk.views.startersAndLeavers",
      filters: {
        root: {
          op: "and",
          children: [
            {
              key: "customField",
              field: "request-type",
              operator: "in",
              options: ["new-starter", "leaver"],
            },
            { key: "group", operator: "in", values: OPEN },
          ],
        },
      },
      display: { layout: "calendar", groupBy: null },
    },
  ],

  taskTemplates: [
    {
      name: "projectTemplates:content.hr-service-desk.taskTemplates.newStarter.name",
      description:
        "projectTemplates:content.hr-service-desk.taskTemplates.newStarter.description",
      priority: "high",
      subtasks: [
        "projectTemplates:content.hr-service-desk.subtasks.contract",
        "projectTemplates:content.hr-service-desk.subtasks.payroll",
        "projectTemplates:content.hr-service-desk.subtasks.equipment",
        "projectTemplates:content.hr-service-desk.subtasks.accessCard",
        "projectTemplates:content.hr-service-desk.subtasks.firstDay",
        "projectTemplates:content.hr-service-desk.subtasks.checkIn",
      ],
    },
    {
      name: "projectTemplates:content.hr-service-desk.taskTemplates.leaver.name",
      description:
        "projectTemplates:content.hr-service-desk.taskTemplates.leaver.description",
      priority: "high",
      subtasks: [
        "projectTemplates:content.hr-service-desk.subtasks.endDate",
        "projectTemplates:content.hr-service-desk.subtasks.finalPay",
        "projectTemplates:content.hr-service-desk.subtasks.equipmentReturn",
        "projectTemplates:content.hr-service-desk.subtasks.accountsClosed",
        "projectTemplates:content.hr-service-desk.subtasks.exitConversation",
        "projectTemplates:content.hr-service-desk.subtasks.referencePolicy",
      ],
    },
    {
      name: "projectTemplates:content.hr-service-desk.taskTemplates.leaveRequest.name",
      description:
        "projectTemplates:content.hr-service-desk.taskTemplates.leaveRequest.description",
      priority: "medium",
    },
    {
      name: "projectTemplates:content.hr-service-desk.taskTemplates.policyQuestion.name",
      description:
        "projectTemplates:content.hr-service-desk.taskTemplates.policyQuestion.description",
      priority: "low",
    },
    {
      name: "projectTemplates:content.hr-service-desk.taskTemplates.concern.name",
      description:
        "projectTemplates:content.hr-service-desk.taskTemplates.concern.description",
      priority: "urgent",
      labels: ["sensitive"],
    },
  ],

  automationRules: [
    {
      name: "projectTemplates:content.hr-service-desk.rules.onboarding",
      trigger: { type: "task_created", fromIntake: true },
      conditions: {
        op: "and",
        conditions: [
          {
            field: "custom_field",
            fieldKey: "request-type",
            op: "equals",
            value: "new-starter",
          },
        ],
      },
      actions: [
        {
          type: "create_subtask",
          title: "projectTemplates:content.hr-service-desk.subtasks.contract",
        },
        {
          type: "create_subtask",
          title: "projectTemplates:content.hr-service-desk.subtasks.payroll",
        },
        {
          type: "create_subtask",
          title: "projectTemplates:content.hr-service-desk.subtasks.equipment",
        },
        {
          type: "create_subtask",
          title: "projectTemplates:content.hr-service-desk.subtasks.accessCard",
        },
        {
          type: "create_subtask",
          title: "projectTemplates:content.hr-service-desk.subtasks.firstDay",
        },
      ],
    },
    {
      name: "projectTemplates:content.hr-service-desk.rules.offboarding",
      trigger: { type: "task_created", fromIntake: true },
      conditions: {
        op: "and",
        conditions: [
          {
            field: "custom_field",
            fieldKey: "request-type",
            op: "equals",
            value: "leaver",
          },
        ],
      },
      actions: [
        {
          type: "create_subtask",
          title: "projectTemplates:content.hr-service-desk.subtasks.endDate",
        },
        {
          type: "create_subtask",
          title: "projectTemplates:content.hr-service-desk.subtasks.finalPay",
        },
        {
          type: "create_subtask",
          title:
            "projectTemplates:content.hr-service-desk.subtasks.equipmentReturn",
        },
        {
          type: "create_subtask",
          title:
            "projectTemplates:content.hr-service-desk.subtasks.accountsClosed",
        },
        {
          type: "create_subtask",
          title:
            "projectTemplates:content.hr-service-desk.subtasks.exitConversation",
        },
      ],
    },
    {
      name: "projectTemplates:content.hr-service-desk.rules.sensitive",
      trigger: { type: "task_created", fromIntake: true },
      conditions: {
        op: "and",
        conditions: [
          {
            field: "custom_field",
            fieldKey: "sensitive",
            op: "equals",
            value: "true",
          },
        ],
      },
      actions: [
        { type: "add_label", label: "sensitive" },
        {
          type: "notify",
          roles: ["lead"],
          message:
            "projectTemplates:content.hr-service-desk.rules.sensitiveMessage",
        },
      ],
    },
    {
      name: "projectTemplates:content.hr-service-desk.rules.late",
      trigger: { type: "due_date_passed" },
      // Closed cases keep their due date; nobody needs to hear about those.
      conditions: {
        op: "and",
        conditions: [
          {
            field: "status",
            op: "is_not",
            columns: ["resolved", "withdrawn"],
          },
        ],
      },
      actions: [
        {
          type: "notify",
          roles: ["assignees"],
          message: "projectTemplates:content.hr-service-desk.rules.lateMessage",
        },
      ],
    },
  ],

  intakeForm: {
    title: "projectTemplates:content.hr-service-desk.form.title",
    intro: "projectTemplates:content.hr-service-desk.form.intro",
    descriptionField: "required",
    emailField: "required",
    nameField: "required",
    customFields: ["request-type", "key-date", "sensitive"],
    confirmationMessage:
      "projectTemplates:content.hr-service-desk.form.confirmation",
  },

  pages: [
    {
      key: "questions",
      title: "projectTemplates:content.hr-service-desk.pages.questions.title",
      logo: { kind: "icon", value: "BookOpen" },
      sections: [
        {
          heading:
            "projectTemplates:content.hr-service-desk.pages.questions.payDates",
          starter:
            "projectTemplates:content.hr-service-desk.pages.questions.payDatesStarter",
        },
        {
          heading:
            "projectTemplates:content.hr-service-desk.pages.questions.leave",
          starter:
            "projectTemplates:content.hr-service-desk.pages.questions.leaveStarter",
        },
        {
          heading:
            "projectTemplates:content.hr-service-desk.pages.questions.benefits",
          starter:
            "projectTemplates:content.hr-service-desk.pages.questions.benefitsStarter",
        },
        {
          heading:
            "projectTemplates:content.hr-service-desk.pages.questions.details",
          starter:
            "projectTemplates:content.hr-service-desk.pages.questions.detailsStarter",
        },
        {
          heading: "projectTemplates:common.pages.whoToCall",
          starter:
            "projectTemplates:content.hr-service-desk.pages.questions.whoToCallStarter",
        },
      ],
    },
    {
      key: "onboarding",
      title: "projectTemplates:content.hr-service-desk.pages.onboarding.title",
      logo: { kind: "icon", value: "List" },
      sections: [
        {
          heading:
            "projectTemplates:content.hr-service-desk.pages.onboarding.before",
          starter:
            "projectTemplates:content.hr-service-desk.pages.onboarding.beforeStarter",
        },
        {
          heading:
            "projectTemplates:content.hr-service-desk.pages.onboarding.firstDay",
          starter:
            "projectTemplates:content.hr-service-desk.pages.onboarding.firstDayStarter",
        },
        {
          heading:
            "projectTemplates:content.hr-service-desk.pages.onboarding.firstWeek",
          starter:
            "projectTemplates:content.hr-service-desk.pages.onboarding.firstWeekStarter",
        },
        {
          heading:
            "projectTemplates:content.hr-service-desk.pages.onboarding.owners",
          starter: "-",
        },
      ],
    },
    {
      key: "offboarding",
      title: "projectTemplates:content.hr-service-desk.pages.offboarding.title",
      logo: { kind: "icon", value: "List" },
      sections: [
        {
          heading:
            "projectTemplates:content.hr-service-desk.pages.offboarding.notice",
          starter:
            "projectTemplates:content.hr-service-desk.pages.offboarding.noticeStarter",
        },
        {
          heading:
            "projectTemplates:content.hr-service-desk.pages.offboarding.lastDay",
          starter:
            "projectTemplates:content.hr-service-desk.pages.offboarding.lastDayStarter",
        },
        {
          heading:
            "projectTemplates:content.hr-service-desk.pages.offboarding.after",
          starter:
            "projectTemplates:content.hr-service-desk.pages.offboarding.afterStarter",
        },
      ],
    },
    {
      key: "sensitive-cases",
      title: "projectTemplates:content.hr-service-desk.pages.sensitive.title",
      logo: { kind: "icon", value: "Shield" },
      sections: [
        {
          heading:
            "projectTemplates:content.hr-service-desk.pages.sensitive.whoCanSee",
          starter:
            "projectTemplates:content.hr-service-desk.pages.sensitive.whoCanSeeStarter",
        },
        {
          heading:
            "projectTemplates:content.hr-service-desk.pages.sensitive.notes",
          starter:
            "projectTemplates:content.hr-service-desk.pages.sensitive.notesStarter",
        },
        {
          heading:
            "projectTemplates:content.hr-service-desk.pages.sensitive.titles",
          starter:
            "projectTemplates:content.hr-service-desk.pages.sensitive.titlesStarter",
        },
        {
          heading:
            "projectTemplates:content.hr-service-desk.pages.sensitive.retention",
          starter:
            "projectTemplates:content.hr-service-desk.pages.sensitive.retentionStarter",
        },
      ],
    },
  ],

  sample: {
    tasks: [
      {
        key: "new-starter",
        title: "projectTemplates:content.hr-service-desk.samples.newStarter",
        description:
          "projectTemplates:content.hr-service-desk.samples.newStarterDescription",
        column: "in-progress",
        priority: "high",
        assignee: "creator",
        startInDays: -1,
        dueInDays: 7,
        customFields: { "request-type": "new-starter" },
        subtasks: [
          "projectTemplates:content.hr-service-desk.subtasks.contract",
          "projectTemplates:content.hr-service-desk.subtasks.equipment",
        ],
      },
      {
        key: "leaver",
        title: "projectTemplates:content.hr-service-desk.samples.leaver",
        column: "new",
        priority: "high",
        dueInDays: 10,
        customFields: { "request-type": "leaver" },
      },
      {
        key: "parental-leave",
        title: "projectTemplates:content.hr-service-desk.samples.parentalLeave",
        description:
          "projectTemplates:content.hr-service-desk.samples.parentalLeaveDescription",
        column: "resolved",
        priority: "low",
        labels: ["policy-gap"],
        customFields: { "request-type": "policy" },
      },
      {
        key: "overtime",
        title: "projectTemplates:content.hr-service-desk.samples.overtime",
        description:
          "projectTemplates:content.hr-service-desk.samples.overtimeDescription",
        column: "in-progress",
        priority: "urgent",
        assignee: "creator",
        dueInDays: 1,
        customFields: { "request-type": "pay" },
      },
      {
        key: "address",
        title: "projectTemplates:content.hr-service-desk.samples.address",
        description:
          "projectTemplates:content.hr-service-desk.samples.addressDescription",
        column: "waiting-on-employee",
        priority: "low",
        dueInDays: 5,
        customFields: { "request-type": "details" },
      },
      {
        key: "concern",
        title: "projectTemplates:content.hr-service-desk.samples.concern",
        description:
          "projectTemplates:content.hr-service-desk.samples.concernDescription",
        column: "in-progress",
        priority: "urgent",
        labels: ["sensitive"],
        assignee: "creator",
        dueInDays: 1,
        customFields: { "request-type": "concern", sensitive: "true" },
      },
    ],
  },
};

export default template;
