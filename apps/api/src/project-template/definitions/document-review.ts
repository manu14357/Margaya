import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/document-review.md

const template: ProjectTemplate = {
  id: "document-review",
  version: 1,
  categories: ["legal", "work-management"],
  icon: "FileText",
  name: "projectTemplates:catalog.document-review.name",
  pitch: "projectTemplates:catalog.document-review.pitch",
  description: "projectTemplates:catalog.document-review.description",
  suggestedKey: "DOC",

  project: {
    description: "projectTemplates:content.document-review.projectDescription",
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

  // In review and Revising form the loop; review rounds count its turns.
  columns: [
    {
      key: "draft",
      name: "projectTemplates:content.document-review.statuses.draft",
      group: "unstarted",
    },
    {
      key: "in-review",
      name: "projectTemplates:common.statuses.inReview",
      group: "started",
    },
    {
      key: "revising",
      name: "projectTemplates:content.document-review.statuses.revising",
      group: "started",
    },
    {
      key: "ready-for-sign-off",
      name: "projectTemplates:content.document-review.statuses.readyForSignOff",
      group: "started",
    },
    {
      key: "signed-off",
      name: "projectTemplates:content.document-review.statuses.signedOff",
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
      key: "contract",
      name: "projectTemplates:content.document-review.labels.contract",
      color: "purple",
    },
    {
      key: "procedure",
      name: "projectTemplates:content.document-review.labels.procedure",
      color: "teal",
    },
    {
      key: "report",
      name: "projectTemplates:content.document-review.labels.report",
      color: "green",
    },
    {
      key: "high-risk",
      name: "projectTemplates:common.labels.highRisk",
      color: "red",
    },
  ],

  customFields: [
    {
      key: "version",
      name: "projectTemplates:common.fields.version",
      type: "text",
    },
    {
      key: "review-round",
      name: "projectTemplates:content.document-review.fields.reviewRound",
      type: "number",
    },
    {
      key: "approver",
      name: "projectTemplates:content.document-review.fields.approver",
      type: "text",
    },
  ],

  views: [
    {
      name: "projectTemplates:content.document-review.views.reviewQueue",
      description:
        "projectTemplates:content.document-review.views.reviewQueueDescription",
      filters: {
        root: {
          key: "status",
          operator: "in",
          columns: ["in-review", "ready-for-sign-off"],
        },
      },
      display: {
        layout: "list",
        groupBy: "status",
        orderBy: { field: "dueDate", direction: "asc" },
      },
    },
    {
      name: "projectTemplates:content.document-review.views.highRisk",
      description:
        "projectTemplates:content.document-review.views.highRiskDescription",
      filters: {
        root: {
          op: "and",
          children: [
            { key: "label", operator: "in", labels: ["high-risk"] },
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
      name: "projectTemplates:content.document-review.views.documentRegister",
      description:
        "projectTemplates:content.document-review.views.documentRegisterDescription",
      filters: {
        root: { key: "group", operator: "notIn", values: ["cancelled"] },
      },
      display: {
        layout: "spreadsheet",
        groupBy: null,
        orderBy: { field: "updatedAt", direction: "desc" },
      },
      displayProperties: {
        status: true,
        dueDate: true,
        customFields: ["version", "review-round", "approver"],
      },
    },
  ],

  taskTemplates: [
    {
      name: "projectTemplates:content.document-review.taskTemplates.reviewRequest.name",
      description:
        "projectTemplates:content.document-review.taskTemplates.reviewRequest.description",
      priority: "medium",
    },
  ],

  automationRules: [
    {
      name: "projectTemplates:content.document-review.rules.askForNewVersion",
      trigger: { type: "status_changed", to: ["revising"] },
      actions: [
        {
          type: "add_comment",
          template:
            "projectTemplates:content.document-review.rules.revisingComment",
        },
      ],
    },
    {
      name: "projectTemplates:content.document-review.rules.readyForSignOff",
      trigger: { type: "status_changed", to: ["ready-for-sign-off"] },
      actions: [
        {
          type: "notify",
          roles: ["lead"],
          message:
            "projectTemplates:content.document-review.rules.readyMessage",
        },
      ],
    },
    {
      name: "projectTemplates:content.document-review.rules.freezeSignedOff",
      trigger: { type: "status_changed", to: ["signed-off"] },
      actions: [
        {
          type: "add_comment",
          template:
            "projectTemplates:content.document-review.rules.signedOffComment",
        },
      ],
    },
  ],

  sample: {
    tasks: [
      {
        key: "supplier-agreement",
        title:
          "projectTemplates:content.document-review.samples.supplierAgreement",
        description:
          "projectTemplates:content.document-review.samples.supplierAgreementDescription",
        column: "ready-for-sign-off",
        priority: "high",
        labels: ["contract"],
        assignee: "creator",
        dueInDays: 3,
        customFields: {
          version: "projectTemplates:content.document-review.samples.v2",
          "review-round": "2",
          approver:
            "projectTemplates:content.document-review.samples.headOfOperations",
        },
      },
      {
        key: "fire-procedure",
        title: "projectTemplates:content.document-review.samples.fireProcedure",
        description:
          "projectTemplates:content.document-review.samples.fireProcedureDescription",
        column: "in-review",
        priority: "high",
        labels: ["procedure", "high-risk"],
        dueInDays: 5,
        customFields: {
          version: "projectTemplates:content.document-review.samples.v1",
          "review-round": "1",
          approver:
            "projectTemplates:content.document-review.samples.safetyManager",
        },
      },
      {
        key: "satisfaction-report",
        title:
          "projectTemplates:content.document-review.samples.satisfactionReport",
        column: "revising",
        priority: "medium",
        labels: ["report"],
        dueInDays: 8,
        customFields: {
          version: "projectTemplates:content.document-review.samples.v2",
          "review-round": "1",
        },
      },
      {
        key: "nda-template",
        title: "projectTemplates:content.document-review.samples.ndaTemplate",
        column: "draft",
        priority: "low",
        labels: ["contract"],
      },
      {
        key: "returns-procedure",
        title:
          "projectTemplates:content.document-review.samples.returnsProcedure",
        column: "signed-off",
        priority: "medium",
        labels: ["procedure"],
        customFields: {
          version: "projectTemplates:content.document-review.samples.v4",
          approver:
            "projectTemplates:content.document-review.samples.headOfOperations",
        },
      },
    ],
  },
};

export default template;
