import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/it-service-management.md

const OPEN = ["unstarted", "started"] as const;
const T = "projectTemplates:content.it-service-management";

const template: ProjectTemplate = {
  id: "it-service-management",
  version: 1,
  categories: ["service-management", "it"],
  icon: "Zap",
  name: "projectTemplates:catalog.it-service-management.name",
  pitch: "projectTemplates:catalog.it-service-management.pitch",
  description: "projectTemplates:catalog.it-service-management.description",
  suggestedKey: "ITSM",

  project: {
    description: `${T}.projectDescription`,
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

  // One set of statuses serves all four record types; the label says which.
  columns: [
    {
      key: "new",
      name: "projectTemplates:common.statuses.new",
      group: "unstarted",
    },
    {
      key: "awaiting-approval",
      name: "projectTemplates:common.statuses.awaitingApproval",
      group: "unstarted",
    },
    {
      key: "in-progress",
      name: "projectTemplates:common.statuses.inProgress",
      group: "started",
    },
    {
      key: "waiting",
      name: "projectTemplates:common.statuses.waiting",
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

  // Six labels on purpose: four record types plus two markers the rules and
  // views depend on.
  labels: [
    {
      key: "incident",
      name: "projectTemplates:common.labels.incident",
      color: "red",
    },
    {
      key: "service-request",
      name: `${T}.labels.serviceRequest`,
      color: "green",
    },
    { key: "problem", name: `${T}.labels.problem`, color: "orange" },
    {
      key: "change",
      name: "projectTemplates:common.labels.change",
      color: "purple",
    },
    {
      key: "major-incident",
      name: `${T}.labels.majorIncident`,
      color: "pink",
    },
    { key: "known-error", name: `${T}.labels.knownError`, color: "yellow" },
  ],

  customFields: [
    {
      key: "impact",
      name: "projectTemplates:common.fields.impact",
      type: "dropdown",
      options: [
        { key: "one-person", label: `${T}.options.impact.onePerson` },
        { key: "one-team", label: "projectTemplates:common.options.oneTeam" },
        { key: "many", label: `${T}.options.impact.many` },
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
      key: "service",
      name: "projectTemplates:common.fields.service",
      type: "dropdown",
      options: [
        { key: "email", label: `${T}.options.service.email` },
        { key: "network", label: `${T}.options.service.network` },
        { key: "devices", label: `${T}.options.service.devices` },
        { key: "accounts", label: `${T}.options.service.accounts` },
        { key: "business-apps", label: `${T}.options.service.businessApps` },
        { key: "other", label: "projectTemplates:common.options.other" },
      ],
      defaultOption: "other",
    },
    {
      key: "change-type",
      name: "projectTemplates:common.fields.changeType",
      type: "dropdown",
      options: [
        { key: "standard", label: "projectTemplates:common.options.standard" },
        { key: "normal", label: "projectTemplates:common.options.normal" },
        {
          key: "emergency",
          label: "projectTemplates:common.options.emergency",
        },
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
        groupBy: "label",
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
      description: `${T}.views.breachingSoonDescription`,
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
      name: "projectTemplates:common.views.changeCalendar",
      description: `${T}.views.changeCalendarDescription`,
      filters: {
        root: { key: "label", operator: "in", labels: ["change"] },
      },
      display: { layout: "calendar" },
    },
    {
      name: `${T}.views.problems`,
      filters: {
        root: {
          key: "label",
          operator: "in",
          labels: ["problem", "known-error"],
        },
      },
      display: {
        layout: "list",
        groupBy: "label",
        orderBy: { field: "updatedAt", direction: "desc" },
      },
    },
  ],

  taskTemplates: [
    {
      name: `${T}.taskTemplates.incident.name`,
      description: `${T}.taskTemplates.incident.description`,
      priority: "medium",
      labels: ["incident"],
    },
    {
      name: `${T}.taskTemplates.majorIncident.name`,
      description: `${T}.taskTemplates.majorIncident.description`,
      priority: "urgent",
      labels: ["incident", "major-incident"],
      subtasks: [
        `${T}.subtasks.nameLead`,
        `${T}.subtasks.statusNotes`,
        `${T}.subtasks.restore`,
        `${T}.subtasks.tellEveryone`,
        `${T}.subtasks.review`,
      ],
    },
    {
      name: `${T}.taskTemplates.serviceRequest.name`,
      description: `${T}.taskTemplates.serviceRequest.description`,
      priority: "low",
      labels: ["service-request"],
    },
    {
      name: `${T}.taskTemplates.problem.name`,
      description: `${T}.taskTemplates.problem.description`,
      priority: "medium",
      labels: ["problem"],
    },
    {
      name: `${T}.taskTemplates.standardChange.name`,
      description: `${T}.taskTemplates.standardChange.description`,
      priority: "low",
      labels: ["change"],
    },
    {
      name: `${T}.taskTemplates.normalChange.name`,
      description: `${T}.taskTemplates.normalChange.description`,
      column: "awaiting-approval",
      priority: "medium",
      labels: ["change"],
    },
    {
      name: `${T}.taskTemplates.emergencyChange.name`,
      description: `${T}.taskTemplates.emergencyChange.description`,
      priority: "urgent",
      labels: ["change"],
    },
  ],

  automationRules: [
    {
      name: `${T}.rules.targetUrgent`,
      trigger: { type: "task_created", fromIntake: true },
      conditions: {
        op: "and",
        conditions: [{ field: "priority", op: "is", values: ["urgent"] }],
      },
      actions: [{ type: "set_due_date", offsetDays: 0 }],
    },
    {
      name: `${T}.rules.targetHigh`,
      trigger: { type: "task_created", fromIntake: true },
      conditions: {
        op: "and",
        conditions: [{ field: "priority", op: "is", values: ["high"] }],
      },
      actions: [{ type: "set_due_date", offsetDays: 1 }],
    },
    {
      name: `${T}.rules.targetMedium`,
      trigger: { type: "task_created", fromIntake: true },
      conditions: {
        op: "and",
        conditions: [{ field: "priority", op: "is", values: ["medium"] }],
      },
      actions: [{ type: "set_due_date", offsetDays: 3 }],
    },
    {
      name: `${T}.rules.targetLow`,
      trigger: { type: "task_created", fromIntake: true },
      conditions: {
        op: "and",
        conditions: [{ field: "priority", op: "is", values: ["low"] }],
      },
      actions: [{ type: "set_due_date", offsetDays: 5 }],
    },
    {
      name: `${T}.rules.safetyNet`,
      trigger: { type: "task_created", fromIntake: true },
      conditions: {
        op: "and",
        conditions: [
          {
            field: "custom_field",
            fieldKey: "impact",
            op: "equals",
            value: "many",
          },
          {
            field: "custom_field",
            fieldKey: "urgency",
            op: "equals",
            value: "stopped",
          },
        ],
      },
      actions: [
        { type: "set_priority", priority: "urgent" },
        { type: "set_due_date", offsetDays: 0 },
      ],
    },
    {
      name: `${T}.rules.majorIncident`,
      trigger: { type: "label_added", labels: ["major-incident"] },
      actions: [
        { type: "set_priority", priority: "urgent" },
        {
          type: "notify",
          roles: ["lead", "assignees"],
          message: `${T}.rules.majorIncidentMessage`,
        },
      ],
    },
    {
      name: `${T}.rules.lateOwner`,
      trigger: { type: "due_date_passed" },
      // Closed records keep their due date; nobody needs to hear about those.
      conditions: {
        op: "and",
        conditions: [
          {
            op: "or",
            conditions: [
              { field: "labels", op: "contains", labels: ["incident"] },
              { field: "labels", op: "contains", labels: ["service-request"] },
            ],
          },
          { field: "status", op: "is_not", columns: ["resolved", "wont-do"] },
        ],
      },
      actions: [
        {
          type: "notify",
          roles: ["assignees", "lead"],
          message: `${T}.rules.lateMessage`,
        },
      ],
    },
  ],

  scheduledAutomations: { autoArchive: { enabled: true, months: 3 } },

  intakeForm: {
    title: `${T}.form.title`,
    intro: `${T}.form.intro`,
    descriptionField: "required",
    emailField: "required",
    nameField: "required",
    customFields: ["service", "impact", "urgency"],
    confirmationMessage: `${T}.form.confirmation`,
  },

  pages: [
    {
      key: "priority-targets",
      title: `${T}.pages.priority.title`,
      logo: { kind: "icon", value: "Target" },
      sections: [
        {
          heading: `${T}.pages.priority.matrix`,
          starter: `${T}.pages.priority.matrixStarter`,
        },
        {
          heading: `${T}.pages.priority.targets`,
          starter: `${T}.pages.priority.targetsStarter`,
        },
        {
          heading: `${T}.pages.priority.major`,
          starter: `${T}.pages.priority.majorStarter`,
        },
      ],
    },
    {
      key: "major-incident-runbook",
      title: `${T}.pages.runbook.title`,
      logo: { kind: "icon", value: "Radio" },
      sections: [
        {
          heading: `${T}.pages.runbook.lead`,
          starter: `${T}.pages.runbook.leadStarter`,
        },
        {
          heading: `${T}.pages.runbook.updates`,
          starter: `${T}.pages.runbook.updatesStarter`,
        },
        {
          heading: `${T}.pages.runbook.close`,
          starter: `${T}.pages.runbook.closeStarter`,
        },
        {
          heading: `${T}.pages.runbook.review`,
          starter: `${T}.pages.runbook.reviewStarter`,
        },
      ],
    },
    {
      key: "change-policy",
      title: "projectTemplates:common.pages.changePolicy",
      logo: { kind: "icon", value: "ScrollText" },
      sections: [
        {
          heading: `${T}.pages.changePolicy.types`,
          starter: `${T}.pages.changePolicy.typesStarter`,
        },
        { heading: `${T}.pages.changePolicy.preApproved`, starter: "-" },
        {
          heading: "projectTemplates:common.pages.whoApproves",
          starter: `${T}.pages.changePolicy.approvesStarter`,
        },
        {
          heading: `${T}.pages.changePolicy.windows`,
          starter: `${T}.pages.changePolicy.windowsStarter`,
        },
        {
          heading: `${T}.pages.changePolicy.undo`,
          starter: `${T}.pages.changePolicy.undoStarter`,
        },
      ],
    },
    {
      key: "known-errors",
      title: `${T}.pages.knownErrors.title`,
      logo: { kind: "icon", value: "BookOpen" },
      sections: [
        {
          heading: `${T}.pages.knownErrors.howToAdd`,
          starter: `${T}.pages.knownErrors.howToAddStarter`,
        },
        { heading: "projectTemplates:common.pages.symptoms", starter: "-" },
        { heading: `${T}.pages.knownErrors.cause`, starter: "-" },
        { heading: "projectTemplates:common.pages.workaround", starter: "-" },
        {
          heading: `${T}.pages.knownErrors.fix`,
          starter: `${T}.pages.knownErrors.fixStarter`,
        },
      ],
    },
    {
      key: "service-catalogue",
      title: `${T}.pages.catalogue.title`,
      logo: { kind: "icon", value: "List" },
      sections: [
        { heading: `${T}.pages.catalogue.offer`, starter: "-" },
        {
          heading: `${T}.pages.catalogue.howToAsk`,
          starter: `${T}.pages.catalogue.howToAskStarter`,
        },
        {
          heading: "projectTemplates:common.pages.leadTimes",
          starter: `${T}.pages.catalogue.leadTimesStarter`,
        },
      ],
    },
  ],

  sample: {
    tasks: [
      {
        key: "mail-outage",
        title: `${T}.samples.mailOutage`,
        description: `${T}.samples.mailOutageDescription`,
        column: "resolved",
        priority: "urgent",
        labels: ["incident", "major-incident"],
        assignee: "creator",
        dueInDays: -1,
        customFields: {
          service: "email",
          impact: "many",
          urgency: "stopped",
        },
      },
      {
        key: "mail-queue",
        title: `${T}.samples.mailQueue`,
        description: `${T}.samples.mailQueueDescription`,
        column: "in-progress",
        priority: "high",
        labels: ["problem", "known-error"],
        assignee: "creator",
        startInDays: -1,
        dueInDays: 6,
        customFields: { service: "email" },
        relations: [{ type: "related", to: "mail-outage" }],
      },
      {
        key: "queue-limit",
        title: `${T}.samples.queueLimit`,
        description: `${T}.samples.queueLimitDescription`,
        column: "awaiting-approval",
        priority: "medium",
        labels: ["change"],
        startInDays: 3,
        dueInDays: 3,
        customFields: { service: "email", "change-type": "normal" },
        relations: [{ type: "related", to: "mail-queue" }],
      },
      {
        key: "finance-access",
        title: `${T}.samples.financeAccess`,
        column: "new",
        priority: "low",
        dueInDays: 5,
        customFields: {
          service: "accounts",
          impact: "one-person",
          urgency: "can-wait",
        },
      },
      {
        key: "video-calls",
        title: `${T}.samples.videoCalls`,
        description: `${T}.samples.videoCallsDescription`,
        column: "waiting",
        priority: "medium",
        labels: ["incident"],
        dueInDays: 2,
        customFields: {
          service: "network",
          impact: "one-team",
          urgency: "slowed",
        },
      },
      {
        key: "security-updates",
        title: `${T}.samples.securityUpdates`,
        column: "new",
        priority: "low",
        labels: ["change"],
        startInDays: 7,
        dueInDays: 7,
        customFields: { service: "devices", "change-type": "standard" },
      },
    ],
  },
};

export default template;
