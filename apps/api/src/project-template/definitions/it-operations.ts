import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/it-operations.md

const notDone = {
  key: "group",
  operator: "notIn",
  values: ["completed", "cancelled"],
} as const;

const template: ProjectTemplate = {
  id: "it-operations",
  version: 1,
  categories: ["it", "operations", "service-management"],
  icon: "Radio",
  name: "projectTemplates:catalog.it-operations.name",
  pitch: "projectTemplates:catalog.it-operations.pitch",
  description: "projectTemplates:catalog.it-operations.description",
  suggestedKey: "OPS",

  project: {
    description: "projectTemplates:content.it-operations.projectDescription",
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
      key: "open",
      name: "projectTemplates:content.it-operations.statuses.open",
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
      key: "watching",
      name: "projectTemplates:content.it-operations.statuses.watching",
      group: "started",
    },
    {
      key: "resolved",
      name: "projectTemplates:common.statuses.resolved",
      group: "completed",
    },
    {
      key: "dismissed",
      name: "projectTemplates:content.it-operations.statuses.dismissed",
      group: "cancelled",
    },
  ],

  labels: [
    {
      key: "alert",
      name: "projectTemplates:content.it-operations.labels.alert",
      color: "yellow",
    },
    {
      key: "incident",
      name: "projectTemplates:common.labels.incident",
      color: "red",
    },
    {
      key: "change",
      name: "projectTemplates:common.labels.change",
      color: "purple",
    },
    {
      key: "follow-up",
      name: "projectTemplates:common.labels.followUp",
      color: "teal",
    },
  ],

  customFields: [
    {
      key: "severity",
      name: "projectTemplates:common.fields.severity",
      type: "dropdown",
      options: [
        {
          key: "sev1",
          label: "projectTemplates:content.it-operations.options.severity.sev1",
        },
        {
          key: "sev2",
          label: "projectTemplates:content.it-operations.options.severity.sev2",
        },
        {
          key: "sev3",
          label: "projectTemplates:content.it-operations.options.severity.sev3",
        },
        {
          key: "sev4",
          label: "projectTemplates:content.it-operations.options.severity.sev4",
        },
      ],
    },
    {
      key: "service",
      name: "projectTemplates:common.fields.service",
      type: "text",
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
      name: "projectTemplates:content.it-operations.views.activeIncidents",
      filters: {
        root: {
          op: "and",
          children: [
            { key: "label", operator: "in", labels: ["incident"] },
            notDone,
          ],
        },
      },
      display: { layout: "board", groupBy: "status" },
    },
    {
      name: "projectTemplates:content.it-operations.views.alertQueue",
      description:
        "projectTemplates:content.it-operations.views.alertQueueDescription",
      filters: {
        root: {
          op: "and",
          children: [
            { key: "label", operator: "in", labels: ["alert"] },
            { key: "status", operator: "in", columns: ["open"] },
          ],
        },
      },
      display: {
        layout: "list",
        groupBy: null,
        orderBy: { field: "createdAt", direction: "desc" },
      },
    },
    {
      name: "projectTemplates:common.views.changeCalendar",
      filters: {
        root: {
          op: "and",
          children: [
            { key: "label", operator: "in", labels: ["change"] },
            { key: "group", operator: "notIn", values: ["cancelled"] },
          ],
        },
      },
      display: { layout: "calendar" },
    },
    {
      name: "projectTemplates:content.it-operations.views.bySeverity",
      filters: { root: notDone },
      display: {
        layout: "list",
        groupBy: { customField: "severity" },
        orderBy: { field: "createdAt", direction: "asc" },
      },
    },
    {
      name: "projectTemplates:content.it-operations.views.followUps",
      description:
        "projectTemplates:content.it-operations.views.followUpsDescription",
      filters: {
        root: {
          op: "and",
          children: [
            { key: "label", operator: "in", labels: ["follow-up"] },
            notDone,
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

  intakeForm: {
    title: "projectTemplates:content.it-operations.form.title",
    intro: "projectTemplates:content.it-operations.form.intro",
    descriptionField: "required",
    nameField: "required",
    emailField: "required",
    customFields: ["service", "severity"],
    confirmationMessage:
      "projectTemplates:content.it-operations.form.confirmation",
  },

  taskTemplates: [
    {
      name: "projectTemplates:content.it-operations.taskTemplates.incident.name",
      description:
        "projectTemplates:content.it-operations.taskTemplates.incident.description",
      priority: "urgent",
      labels: ["incident"],
    },
    {
      name: "projectTemplates:content.it-operations.taskTemplates.change.name",
      description:
        "projectTemplates:content.it-operations.taskTemplates.change.description",
      priority: "medium",
      labels: ["change"],
    },
    {
      name: "projectTemplates:content.it-operations.taskTemplates.review.name",
      titlePattern:
        "projectTemplates:content.it-operations.taskTemplates.review.titlePattern",
      description:
        "projectTemplates:content.it-operations.taskTemplates.review.description",
      priority: "high",
    },
  ],

  automationRules: [
    {
      name: "projectTemplates:content.it-operations.rules.firstResponse",
      trigger: { type: "label_added", labels: ["incident"] },
      actions: [
        { type: "set_priority", priority: "urgent" },
        {
          type: "add_comment",
          template:
            "projectTemplates:content.it-operations.rules.firstResponseComment",
        },
        {
          type: "notify",
          roles: ["lead"],
          message:
            "projectTemplates:content.it-operations.rules.firstResponseMessage",
        },
      ],
    },
    {
      name: "projectTemplates:content.it-operations.rules.reviewSerious",
      trigger: { type: "status_changed", to: ["resolved"] },
      conditions: {
        op: "and",
        conditions: [
          { field: "labels", op: "contains", labels: ["incident"] },
          {
            op: "or",
            conditions: [
              {
                field: "custom_field",
                fieldKey: "severity",
                op: "equals",
                value: "sev1",
              },
              {
                field: "custom_field",
                fieldKey: "severity",
                op: "equals",
                value: "sev2",
              },
            ],
          },
        ],
      },
      actions: [
        {
          type: "create_subtask",
          title: "projectTemplates:content.it-operations.rules.reviewSubtask",
        },
        {
          type: "notify",
          roles: ["assignees"],
          message: "projectTemplates:content.it-operations.rules.reviewMessage",
        },
      ],
    },
    {
      name: "projectTemplates:content.it-operations.rules.approvals",
      trigger: { type: "status_changed", to: ["awaiting-approval"] },
      actions: [
        {
          type: "notify",
          roles: ["lead"],
          message:
            "projectTemplates:content.it-operations.rules.approvalsMessage",
        },
      ],
    },
    {
      name: "projectTemplates:content.it-operations.rules.emergencyReview",
      trigger: { type: "status_changed", to: ["in-progress"] },
      conditions: {
        op: "and",
        conditions: [
          { field: "labels", op: "contains", labels: ["change"] },
          {
            field: "custom_field",
            fieldKey: "change-type",
            op: "equals",
            value: "emergency",
          },
        ],
      },
      actions: [
        {
          type: "create_subtask",
          title:
            "projectTemplates:content.it-operations.rules.emergencySubtask",
        },
        {
          type: "notify",
          roles: ["lead"],
          message:
            "projectTemplates:content.it-operations.rules.emergencyMessage",
        },
      ],
    },
  ],

  scheduledAutomations: {
    autoClose: { enabled: true, months: 1, column: "dismissed" },
  },

  pages: [
    {
      key: "runbook",
      title: "projectTemplates:content.it-operations.pages.runbook.title",
      logo: { kind: "icon", value: "BookOpen" },
      sections: [
        {
          heading:
            "projectTemplates:content.it-operations.pages.runbook.severity",
          starter:
            "projectTemplates:content.it-operations.pages.runbook.severityStarter",
        },
        {
          heading:
            "projectTemplates:content.it-operations.pages.runbook.onCall",
          starter:
            "projectTemplates:content.it-operations.pages.runbook.onCallStarter",
        },
        {
          heading: "projectTemplates:common.pages.whenToEscalate",
          starter:
            "projectTemplates:content.it-operations.pages.runbook.escalateStarter",
        },
        {
          heading:
            "projectTemplates:content.it-operations.pages.runbook.firstMinutes",
          starter: "- [ ]",
        },
        {
          heading:
            "projectTemplates:content.it-operations.pages.runbook.updates",
          starter:
            "projectTemplates:content.it-operations.pages.runbook.updatesStarter",
        },
        {
          heading:
            "projectTemplates:content.it-operations.pages.runbook.declare",
          starter:
            "projectTemplates:content.it-operations.pages.runbook.declareStarter",
        },
      ],
    },
    {
      key: "change-policy",
      title: "projectTemplates:common.pages.changePolicy",
      logo: { kind: "icon", value: "ScrollText" },
      sections: [
        {
          heading:
            "projectTemplates:content.it-operations.pages.changePolicy.types",
          starter:
            "projectTemplates:content.it-operations.pages.changePolicy.typesStarter",
        },
        {
          heading:
            "projectTemplates:content.it-operations.pages.changePolicy.standard",
          starter: "-",
        },
        {
          heading: "projectTemplates:common.pages.whoApproves",
          starter:
            "projectTemplates:content.it-operations.pages.changePolicy.whoApprovesStarter",
        },
        {
          heading:
            "projectTemplates:content.it-operations.pages.changePolicy.emergency",
          starter:
            "projectTemplates:content.it-operations.pages.changePolicy.emergencyStarter",
        },
        {
          heading:
            "projectTemplates:content.it-operations.pages.changePolicy.rollback",
          starter:
            "projectTemplates:content.it-operations.pages.changePolicy.rollbackStarter",
        },
      ],
    },
    {
      key: "review-guide",
      title: "projectTemplates:content.it-operations.pages.reviewGuide.title",
      logo: { kind: "icon", value: "FileText" },
      sections: [
        {
          heading:
            "projectTemplates:content.it-operations.pages.reviewGuide.blameless",
          starter:
            "projectTemplates:content.it-operations.pages.reviewGuide.blamelessStarter",
        },
        {
          heading:
            "projectTemplates:content.it-operations.pages.reviewGuide.whenRequired",
          starter:
            "projectTemplates:content.it-operations.pages.reviewGuide.whenRequiredStarter",
        },
        {
          heading:
            "projectTemplates:content.it-operations.pages.reviewGuide.followUps",
          starter:
            "projectTemplates:content.it-operations.pages.reviewGuide.followUpsStarter",
        },
      ],
    },
  ],

  sample: {
    tasks: [
      {
        key: "disk",
        title: "projectTemplates:content.it-operations.samples.disk",
        column: "open",
        priority: "medium",
        labels: ["alert"],
        customFields: {
          severity: "sev4",
          service:
            "projectTemplates:content.it-operations.samples.services.fileServer",
        },
      },
      {
        key: "vpn",
        title: "projectTemplates:content.it-operations.samples.vpn",
        description:
          "projectTemplates:content.it-operations.samples.vpnDescription",
        column: "in-progress",
        priority: "urgent",
        labels: ["incident"],
        assignee: "creator",
        startInDays: 0,
        customFields: {
          severity: "sev2",
          service:
            "projectTemplates:content.it-operations.samples.services.vpnGateway",
        },
      },
      {
        key: "mail",
        title: "projectTemplates:content.it-operations.samples.mail",
        column: "watching",
        priority: "high",
        labels: ["incident"],
        customFields: {
          severity: "sev3",
          service:
            "projectTemplates:content.it-operations.samples.services.mailRelay",
        },
      },
      {
        key: "database",
        title: "projectTemplates:content.it-operations.samples.database",
        description:
          "projectTemplates:content.it-operations.samples.databaseDescription",
        column: "awaiting-approval",
        priority: "medium",
        labels: ["change"],
        startInDays: 6,
        dueInDays: 6,
        customFields: {
          "change-type": "normal",
          service:
            "projectTemplates:content.it-operations.samples.services.database",
        },
      },
      {
        key: "certificate",
        title: "projectTemplates:content.it-operations.samples.certificate",
        column: "open",
        priority: "low",
        labels: ["change"],
        startInDays: 10,
        dueInDays: 10,
        customFields: {
          "change-type": "standard",
          service:
            "projectTemplates:content.it-operations.samples.services.webFrontEnd",
        },
      },
      {
        key: "vpn-alert",
        title: "projectTemplates:content.it-operations.samples.vpnAlert",
        column: "open",
        priority: "medium",
        labels: ["follow-up"],
        dueInDays: 14,
        customFields: {
          service:
            "projectTemplates:content.it-operations.samples.services.vpnGateway",
        },
        relations: [{ type: "related", to: "vpn" }],
      },
    ],
  },
};

export default template;
