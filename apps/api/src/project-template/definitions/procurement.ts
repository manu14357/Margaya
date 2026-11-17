import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/procurement.md

const template: ProjectTemplate = {
  id: "procurement",
  version: 1,
  categories: ["operations", "work-management"],
  icon: "Package",
  name: "projectTemplates:catalog.procurement.name",
  pitch: "projectTemplates:catalog.procurement.pitch",
  description: "projectTemplates:catalog.procurement.description",
  suggestedKey: "PUR",

  project: {
    description: "projectTemplates:content.procurement.projectDescription",
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
      key: "requested",
      name: "projectTemplates:common.statuses.requested",
      group: "unstarted",
    },
    {
      key: "awaiting-approval",
      name: "projectTemplates:common.statuses.awaitingApproval",
      group: "started",
    },
    {
      key: "ordered",
      name: "projectTemplates:content.procurement.statuses.ordered",
      group: "started",
    },
    {
      key: "received",
      name: "projectTemplates:content.procurement.statuses.received",
      group: "started",
    },
    {
      key: "closed",
      name: "projectTemplates:common.statuses.closed",
      group: "completed",
    },
    {
      key: "rejected",
      name: "projectTemplates:content.procurement.statuses.rejected",
      group: "cancelled",
    },
  ],

  labels: [
    {
      key: "goods",
      name: "projectTemplates:content.procurement.labels.goods",
      color: "teal",
    },
    {
      key: "services",
      name: "projectTemplates:content.procurement.labels.services",
      color: "purple",
    },
    {
      key: "software",
      name: "projectTemplates:common.labels.software",
      color: "dark-gray",
    },
    {
      key: "mismatch",
      name: "projectTemplates:content.procurement.labels.mismatch",
      color: "red",
    },
  ],

  customFields: [
    {
      key: "amount",
      name: "projectTemplates:common.fields.amount",
      type: "number",
    },
    {
      key: "cost-center",
      name: "projectTemplates:common.fields.costCenter",
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
      key: "supplier",
      name: "projectTemplates:common.fields.supplier",
      type: "text",
    },
    {
      key: "po-number",
      name: "projectTemplates:content.procurement.fields.poNumber",
      type: "text",
    },
  ],

  views: [
    {
      name: "projectTemplates:content.procurement.views.approvalQueue",
      description:
        "projectTemplates:content.procurement.views.approvalQueueDescription",
      filters: {
        root: { key: "status", operator: "in", columns: ["awaiting-approval"] },
      },
      display: {
        layout: "list",
        groupBy: null,
        orderBy: { field: { customField: "amount" }, direction: "desc" },
      },
    },
    {
      name: "projectTemplates:content.procurement.views.openOrders",
      filters: {
        root: {
          key: "status",
          operator: "in",
          columns: ["ordered", "received"],
        },
      },
      display: {
        layout: "spreadsheet",
        groupBy: null,
        orderBy: { field: "dueDate", direction: "asc" },
      },
      displayProperties: {
        dueDate: true,
        customFields: ["supplier", "po-number", "amount"],
      },
    },
    {
      name: "projectTemplates:content.procurement.views.spendByCostCenter",
      filters: {
        root: { key: "group", operator: "notIn", values: ["cancelled"] },
      },
      display: {
        layout: "spreadsheet",
        groupBy: { customField: "cost-center" },
      },
      displayProperties: { status: true, customFields: ["amount"] },
    },
  ],

  taskTemplates: [
    {
      name: "projectTemplates:content.procurement.taskTemplates.purchaseRequest.name",
      description:
        "projectTemplates:content.procurement.taskTemplates.purchaseRequest.description",
      priority: "medium",
    },
    {
      name: "projectTemplates:content.procurement.taskTemplates.receiptCheck.name",
      description:
        "projectTemplates:content.procurement.taskTemplates.receiptCheck.description",
      column: "received",
      priority: "medium",
    },
  ],

  automationRules: [
    {
      name: "projectTemplates:content.procurement.rules.checkRequest",
      trigger: { type: "task_created", fromIntake: true },
      actions: [
        {
          type: "add_comment",
          template: "projectTemplates:content.procurement.rules.checkComment",
        },
      ],
    },
    {
      name: "projectTemplates:content.procurement.rules.matchOnReceipt",
      trigger: { type: "status_changed", to: ["received"] },
      actions: [
        {
          type: "create_subtask",
          title: "projectTemplates:content.procurement.subtasks.match",
        },
      ],
    },
    {
      name: "projectTemplates:content.procurement.rules.flagMismatch",
      trigger: { type: "label_added", labels: ["mismatch"] },
      actions: [
        { type: "set_priority", priority: "high" },
        {
          type: "notify",
          roles: ["lead"],
          message: "projectTemplates:content.procurement.rules.mismatchMessage",
        },
      ],
    },
  ],

  intakeForm: {
    title: "projectTemplates:content.procurement.form.title",
    intro: "projectTemplates:content.procurement.form.intro",
    descriptionField: "optional",
    emailField: "required",
    nameField: "required",
    customFields: ["amount", "cost-center", "supplier"],
    confirmationMessage:
      "projectTemplates:content.procurement.form.confirmation",
  },

  pages: [
    {
      key: "purchasing-guide",
      title: "projectTemplates:content.procurement.pages.guide.title",
      logo: { kind: "icon", value: "Package" },
      sections: [
        {
          heading: "projectTemplates:common.pages.whoApproves",
          starter:
            "projectTemplates:content.procurement.pages.guide.whoApprovesStarter",
        },
        {
          heading: "projectTemplates:content.procurement.pages.guide.quotes",
          starter:
            "projectTemplates:content.procurement.pages.guide.quotesStarter",
        },
        {
          heading: "projectTemplates:content.procurement.pages.guide.suppliers",
          starter: "-",
        },
        {
          heading: "projectTemplates:content.procurement.pages.guide.receiving",
          starter:
            "projectTemplates:content.procurement.pages.guide.receivingStarter",
        },
        {
          heading: "projectTemplates:content.procurement.pages.guide.matching",
          starter:
            "projectTemplates:content.procurement.pages.guide.matchingStarter",
        },
      ],
    },
  ],

  sample: {
    tasks: [
      {
        key: "monitors",
        title: "projectTemplates:content.procurement.samples.monitors",
        description:
          "projectTemplates:content.procurement.samples.monitorsDescription",
        column: "awaiting-approval",
        priority: "medium",
        labels: ["goods"],
        dueInDays: 10,
        customFields: { amount: "1200", "cost-center": "operations" },
      },
      {
        key: "design-licences",
        title: "projectTemplates:content.procurement.samples.designLicences",
        column: "ordered",
        priority: "high",
        labels: ["software"],
        assignee: "creator",
        dueInDays: 5,
        customFields: {
          amount: "3400",
          "po-number": "projectTemplates:content.procurement.samples.poNumber",
        },
      },
      {
        key: "window-cleaning",
        title: "projectTemplates:content.procurement.samples.windowCleaning",
        column: "closed",
        priority: "low",
        labels: ["services"],
        customFields: { amount: "180" },
      },
      {
        key: "toner",
        title: "projectTemplates:content.procurement.samples.toner",
        column: "received",
        priority: "low",
        labels: ["goods"],
        customFields: { amount: "95" },
        subtasks: ["projectTemplates:content.procurement.subtasks.match"],
      },
      {
        key: "booth",
        title: "projectTemplates:content.procurement.samples.booth",
        column: "requested",
        priority: "medium",
        labels: ["services"],
        dueInDays: 30,
        customFields: { amount: "2500", "cost-center": "marketing" },
      },
      {
        key: "chairs",
        title: "projectTemplates:content.procurement.samples.chairs",
        description:
          "projectTemplates:content.procurement.samples.chairsDescription",
        column: "received",
        priority: "high",
        labels: ["goods", "mismatch"],
        assignee: "creator",
      },
    ],
  },
};

export default template;
