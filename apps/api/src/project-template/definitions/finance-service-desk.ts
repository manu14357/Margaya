import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/finance-service-desk.md

const OPEN = ["unstarted", "started"] as const;

const template: ProjectTemplate = {
  id: "finance-service-desk",
  version: 1,
  categories: ["service-management", "finance"],
  icon: "Wallet",
  name: "projectTemplates:catalog.finance-service-desk.name",
  pitch: "projectTemplates:catalog.finance-service-desk.pitch",
  description: "projectTemplates:catalog.finance-service-desk.description",
  suggestedKey: "FIN",
  // Requests carry pay and bank details.
  suggestedVisibility: "restricted",

  project: {
    description:
      "projectTemplates:content.finance-service-desk.projectDescription",
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
      key: "awaiting-approval",
      name: "projectTemplates:common.statuses.awaitingApproval",
      group: "started",
    },
    {
      key: "processing",
      name: "projectTemplates:content.finance-service-desk.statuses.processing",
      group: "started",
    },
    {
      key: "waiting-on-requester",
      name: "projectTemplates:common.statuses.waitingOnRequester",
      group: "started",
    },
    {
      key: "done",
      name: "projectTemplates:common.statuses.done",
      group: "completed",
    },
    {
      key: "not-approved",
      name: "projectTemplates:content.finance-service-desk.statuses.notApproved",
      group: "cancelled",
    },
  ],

  labels: [
    {
      key: "over-limit",
      name: "projectTemplates:content.finance-service-desk.labels.overLimit",
      color: "orange",
    },
    {
      key: "month-end",
      name: "projectTemplates:content.finance-service-desk.labels.monthEnd",
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
          key: "purchase",
          label:
            "projectTemplates:content.finance-service-desk.options.requestType.purchase",
        },
        {
          key: "expense-claim",
          label:
            "projectTemplates:content.finance-service-desk.options.requestType.expenseClaim",
        },
        {
          key: "supplier-invoice",
          label:
            "projectTemplates:content.finance-service-desk.options.requestType.supplierInvoice",
        },
        {
          key: "new-supplier",
          label:
            "projectTemplates:content.finance-service-desk.options.requestType.newSupplier",
        },
        {
          key: "budget-change",
          label:
            "projectTemplates:content.finance-service-desk.options.requestType.budgetChange",
        },
        { key: "question", label: "projectTemplates:common.options.question" },
      ],
      defaultOption: "question",
    },
    {
      key: "amount",
      name: "projectTemplates:common.fields.amount",
      type: "number",
    },
    {
      key: "cost-center",
      name: "projectTemplates:common.fields.costCenter",
      type: "text",
    },
    {
      key: "needed-by",
      name: "projectTemplates:common.fields.neededBy",
      type: "date",
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
        "projectTemplates:content.finance-service-desk.views.breachingSoonDescription",
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
      name: "projectTemplates:common.views.awaitingApproval",
      description:
        "projectTemplates:content.finance-service-desk.views.awaitingApprovalDescription",
      filters: {
        root: { key: "status", operator: "in", columns: ["awaiting-approval"] },
      },
      display: {
        layout: "spreadsheet",
        groupBy: null,
        orderBy: { field: { customField: "amount" }, direction: "desc" },
      },
      displayProperties: {
        customFields: ["amount", "cost-center", "request-type"],
      },
    },
  ],

  taskTemplates: [
    {
      name: "projectTemplates:content.finance-service-desk.taskTemplates.purchase.name",
      description:
        "projectTemplates:content.finance-service-desk.taskTemplates.purchase.description",
      priority: "medium",
    },
    {
      name: "projectTemplates:content.finance-service-desk.taskTemplates.expenseClaim.name",
      description:
        "projectTemplates:content.finance-service-desk.taskTemplates.expenseClaim.description",
      priority: "medium",
    },
    {
      name: "projectTemplates:content.finance-service-desk.taskTemplates.supplierInvoice.name",
      description:
        "projectTemplates:content.finance-service-desk.taskTemplates.supplierInvoice.description",
      priority: "high",
    },
    {
      name: "projectTemplates:content.finance-service-desk.taskTemplates.newSupplier.name",
      description:
        "projectTemplates:content.finance-service-desk.taskTemplates.newSupplier.description",
      priority: "medium",
    },
    {
      name: "projectTemplates:content.finance-service-desk.taskTemplates.budgetChange.name",
      description:
        "projectTemplates:content.finance-service-desk.taskTemplates.budgetChange.description",
      priority: "medium",
    },
  ],

  automationRules: [
    {
      name: "projectTemplates:content.finance-service-desk.rules.invoicesToApproval",
      trigger: { type: "task_created", fromIntake: true },
      conditions: {
        op: "and",
        conditions: [
          {
            field: "custom_field",
            fieldKey: "request-type",
            op: "equals",
            value: "supplier-invoice",
          },
        ],
      },
      actions: [{ type: "set_status", column: "awaiting-approval" }],
    },
    {
      name: "projectTemplates:content.finance-service-desk.rules.lateOwner",
      trigger: { type: "due_date_passed" },
      // Closed requests keep their due date; nobody needs to hear about those.
      conditions: {
        op: "and",
        conditions: [
          { field: "status", op: "is_not", columns: ["done", "not-approved"] },
        ],
      },
      actions: [
        {
          type: "notify",
          roles: ["assignees", "lead"],
          message:
            "projectTemplates:content.finance-service-desk.rules.lateMessage",
        },
      ],
    },
  ],

  intakeForm: {
    title: "projectTemplates:content.finance-service-desk.form.title",
    intro: "projectTemplates:content.finance-service-desk.form.intro",
    descriptionField: "required",
    emailField: "required",
    nameField: "required",
    customFields: ["request-type", "amount", "cost-center", "needed-by"],
    confirmationMessage:
      "projectTemplates:content.finance-service-desk.form.confirmation",
  },

  pages: [
    {
      key: "how-to-ask",
      title:
        "projectTemplates:content.finance-service-desk.pages.howToAsk.title",
      logo: { kind: "icon", value: "MessageSquare" },
      sections: [
        {
          heading: "projectTemplates:common.pages.whatToInclude",
          starter:
            "projectTemplates:content.finance-service-desk.pages.howToAsk.includeStarter",
        },
        {
          heading:
            "projectTemplates:content.finance-service-desk.pages.howToAsk.invoices",
          starter:
            "projectTemplates:content.finance-service-desk.pages.howToAsk.invoicesStarter",
        },
        {
          heading: "projectTemplates:common.pages.leadTimes",
          starter:
            "projectTemplates:content.finance-service-desk.pages.howToAsk.leadTimesStarter",
        },
      ],
    },
    {
      key: "approval-limits",
      title:
        "projectTemplates:content.finance-service-desk.pages.approvalLimits.title",
      logo: { kind: "icon", value: "Wallet" },
      sections: [
        {
          heading: "projectTemplates:common.pages.whoApproves",
          starter:
            "projectTemplates:content.finance-service-desk.pages.approvalLimits.whoApprovesStarter",
        },
        {
          heading:
            "projectTemplates:content.finance-service-desk.pages.approvalLimits.overLimit",
          starter:
            "projectTemplates:content.finance-service-desk.pages.approvalLimits.overLimitStarter",
        },
      ],
    },
    {
      key: "expense-policy",
      title:
        "projectTemplates:content.finance-service-desk.pages.expensePolicy.title",
      logo: { kind: "icon", value: "ScrollText" },
      sections: [
        {
          heading:
            "projectTemplates:content.finance-service-desk.pages.expensePolicy.claimable",
          starter:
            "projectTemplates:content.finance-service-desk.pages.expensePolicy.claimableStarter",
        },
        {
          heading:
            "projectTemplates:content.finance-service-desk.pages.expensePolicy.receipts",
          starter:
            "projectTemplates:content.finance-service-desk.pages.expensePolicy.receiptsStarter",
        },
        {
          heading:
            "projectTemplates:content.finance-service-desk.pages.expensePolicy.deadlines",
          starter:
            "projectTemplates:content.finance-service-desk.pages.expensePolicy.deadlinesStarter",
        },
      ],
    },
    {
      key: "month-end-calendar",
      title:
        "projectTemplates:content.finance-service-desk.pages.monthEnd.title",
      logo: { kind: "icon", value: "Calendar" },
      sections: [
        {
          heading:
            "projectTemplates:content.finance-service-desk.pages.monthEnd.invoices",
          starter:
            "projectTemplates:content.finance-service-desk.pages.monthEnd.invoicesStarter",
        },
        {
          heading:
            "projectTemplates:content.finance-service-desk.pages.monthEnd.claims",
          starter:
            "projectTemplates:content.finance-service-desk.pages.monthEnd.claimsStarter",
        },
        {
          heading:
            "projectTemplates:content.finance-service-desk.pages.monthEnd.budgetChanges",
          starter:
            "projectTemplates:content.finance-service-desk.pages.monthEnd.budgetChangesStarter",
        },
      ],
    },
  ],

  sample: {
    tasks: [
      {
        key: "cleaning-invoice",
        title:
          "projectTemplates:content.finance-service-desk.samples.cleaningInvoice",
        description:
          "projectTemplates:content.finance-service-desk.samples.cleaningInvoiceDescription",
        column: "awaiting-approval",
        priority: "high",
        dueInDays: 4,
        customFields: {
          "request-type": "supplier-invoice",
          amount: "1240",
          "cost-center":
            "projectTemplates:content.finance-service-desk.samples.costCenterFacilities",
        },
      },
      {
        key: "monitors",
        title: "projectTemplates:content.finance-service-desk.samples.monitors",
        column: "processing",
        priority: "medium",
        assignee: "creator",
        dueInDays: 7,
        customFields: {
          "request-type": "purchase",
          amount: "560",
          "cost-center":
            "projectTemplates:content.finance-service-desk.samples.costCenterDesign",
        },
      },
      {
        key: "train-tickets",
        title:
          "projectTemplates:content.finance-service-desk.samples.trainTickets",
        description:
          "projectTemplates:content.finance-service-desk.samples.trainTicketsDescription",
        column: "waiting-on-requester",
        priority: "medium",
        customFields: {
          "request-type": "expense-claim",
          amount: "134",
          "cost-center":
            "projectTemplates:content.finance-service-desk.samples.costCenterSales",
        },
      },
      {
        key: "catering-supplier",
        title:
          "projectTemplates:content.finance-service-desk.samples.cateringSupplier",
        description:
          "projectTemplates:content.finance-service-desk.samples.cateringSupplierDescription",
        column: "new",
        priority: "medium",
        customFields: { "request-type": "new-supplier" },
      },
      {
        key: "budget-move",
        title:
          "projectTemplates:content.finance-service-desk.samples.budgetMove",
        column: "awaiting-approval",
        priority: "medium",
        labels: ["over-limit"],
        customFields: { "request-type": "budget-change", amount: "2000" },
      },
      {
        key: "lunch-question",
        title:
          "projectTemplates:content.finance-service-desk.samples.lunchQuestion",
        column: "done",
        priority: "low",
        customFields: { "request-type": "question" },
      },
    ],
  },
};

export default template;
