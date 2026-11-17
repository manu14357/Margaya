import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/sales-support-desk.md

const OPEN = ["unstarted", "started"] as const;

const template: ProjectTemplate = {
  id: "sales-support-desk",
  version: 1,
  categories: ["service-management", "sales"],
  icon: "Tags",
  name: "projectTemplates:catalog.sales-support-desk.name",
  pitch: "projectTemplates:catalog.sales-support-desk.pitch",
  description: "projectTemplates:catalog.sales-support-desk.description",
  suggestedKey: "DEAL",

  project: {
    description:
      "projectTemplates:content.sales-support-desk.projectDescription",
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
      key: "awaiting-approval",
      name: "projectTemplates:common.statuses.awaitingApproval",
      group: "started",
    },
    {
      key: "waiting-on-seller",
      name: "projectTemplates:content.sales-support-desk.statuses.waitingOnSeller",
      group: "started",
    },
    {
      key: "done",
      name: "projectTemplates:common.statuses.done",
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
      key: "non-standard-terms",
      name: "projectTemplates:content.sales-support-desk.labels.nonStandardTerms",
      color: "orange",
    },
    {
      key: "strategic-deal",
      name: "projectTemplates:content.sales-support-desk.labels.strategicDeal",
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
          key: "quote",
          label:
            "projectTemplates:content.sales-support-desk.options.requestType.quote",
        },
        {
          key: "discount",
          label:
            "projectTemplates:content.sales-support-desk.options.requestType.discount",
        },
        {
          key: "contract-review",
          label: "projectTemplates:common.options.contractReview",
        },
        {
          key: "security",
          label:
            "projectTemplates:content.sales-support-desk.options.requestType.security",
        },
        {
          key: "proposal",
          label:
            "projectTemplates:content.sales-support-desk.options.requestType.proposal",
        },
        {
          key: "product-question",
          label:
            "projectTemplates:content.sales-support-desk.options.requestType.productQuestion",
        },
      ],
      defaultOption: "quote",
    },
    {
      key: "deal-value",
      name: "projectTemplates:common.fields.dealValue",
      type: "number",
    },
    {
      key: "account",
      name: "projectTemplates:content.sales-support-desk.fields.account",
      type: "text",
    },
    {
      // The plan wants this required on the form, but a required field needs
      // a default and a fixed calendar date makes no sense in a template.
      key: "close-date",
      name: "projectTemplates:content.sales-support-desk.fields.closeDate",
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
      name: "projectTemplates:content.sales-support-desk.views.closingSoon",
      description:
        "projectTemplates:content.sales-support-desk.views.closingSoonDescription",
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
                  amount: 3,
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
        "projectTemplates:content.sales-support-desk.views.awaitingApprovalDescription",
      filters: {
        root: { key: "status", operator: "in", columns: ["awaiting-approval"] },
      },
      display: {
        layout: "spreadsheet",
        groupBy: null,
        orderBy: { field: { customField: "deal-value" }, direction: "desc" },
      },
      displayProperties: {
        customFields: ["deal-value", "account", "close-date"],
      },
    },
  ],

  taskTemplates: [
    {
      name: "projectTemplates:content.sales-support-desk.taskTemplates.quote.name",
      description:
        "projectTemplates:content.sales-support-desk.taskTemplates.quote.description",
      priority: "medium",
    },
    {
      name: "projectTemplates:content.sales-support-desk.taskTemplates.discountApproval.name",
      description:
        "projectTemplates:content.sales-support-desk.taskTemplates.discountApproval.description",
      column: "awaiting-approval",
      priority: "high",
      labels: ["non-standard-terms"],
    },
    {
      name: "projectTemplates:content.sales-support-desk.taskTemplates.contractReview.name",
      description:
        "projectTemplates:content.sales-support-desk.taskTemplates.contractReview.description",
      priority: "medium",
    },
    {
      name: "projectTemplates:content.sales-support-desk.taskTemplates.securityQuestionnaire.name",
      description:
        "projectTemplates:content.sales-support-desk.taskTemplates.securityQuestionnaire.description",
      priority: "medium",
    },
    {
      name: "projectTemplates:content.sales-support-desk.taskTemplates.proposal.name",
      description:
        "projectTemplates:content.sales-support-desk.taskTemplates.proposal.description",
      priority: "high",
      subtasks: [
        "projectTemplates:content.sales-support-desk.subtasks.goNoGo",
        "projectTemplates:content.sales-support-desk.subtasks.questionList",
        "projectTemplates:content.sales-support-desk.subtasks.firstDraft",
        "projectTemplates:content.sales-support-desk.subtasks.pricingSection",
        "projectTemplates:content.sales-support-desk.subtasks.finalReview",
        "projectTemplates:content.sales-support-desk.subtasks.submit",
      ],
    },
  ],

  automationRules: [
    {
      name: "projectTemplates:content.sales-support-desk.rules.discountsToApproval",
      trigger: { type: "task_created", fromIntake: true },
      conditions: {
        op: "and",
        conditions: [
          {
            field: "custom_field",
            fieldKey: "request-type",
            op: "equals",
            value: "discount",
          },
        ],
      },
      actions: [
        { type: "set_status", column: "awaiting-approval" },
        { type: "add_label", label: "non-standard-terms" },
      ],
    },
    {
      name: "projectTemplates:content.sales-support-desk.rules.approvalWaiting",
      trigger: { type: "status_changed", to: ["awaiting-approval"] },
      actions: [
        {
          type: "notify",
          roles: ["lead"],
          message:
            "projectTemplates:content.sales-support-desk.rules.approvalMessage",
        },
      ],
    },
    {
      name: "projectTemplates:content.sales-support-desk.rules.lateOwner",
      trigger: { type: "due_date_passed" },
      // Finished requests keep their due date; nobody needs to hear about those.
      conditions: {
        op: "and",
        conditions: [
          { field: "status", op: "is_not", columns: ["done", "withdrawn"] },
        ],
      },
      actions: [
        {
          type: "notify",
          roles: ["assignees"],
          message:
            "projectTemplates:content.sales-support-desk.rules.lateMessage",
        },
      ],
    },
  ],

  intakeForm: {
    title: "projectTemplates:content.sales-support-desk.form.title",
    intro: "projectTemplates:content.sales-support-desk.form.intro",
    descriptionField: "required",
    emailField: "required",
    nameField: "required",
    customFields: ["request-type", "deal-value", "account", "close-date"],
    confirmationMessage:
      "projectTemplates:content.sales-support-desk.form.confirmation",
  },

  pages: [
    {
      key: "pricing-guide",
      title:
        "projectTemplates:content.sales-support-desk.pages.pricingGuide.title",
      logo: { kind: "icon", value: "Tags" },
      sections: [
        {
          heading:
            "projectTemplates:content.sales-support-desk.pages.pricingGuide.priceList",
          starter:
            "projectTemplates:content.sales-support-desk.pages.pricingGuide.priceListStarter",
        },
        {
          heading:
            "projectTemplates:content.sales-support-desk.pages.pricingGuide.discounts",
          starter:
            "projectTemplates:content.sales-support-desk.pages.pricingGuide.discountsStarter",
        },
        {
          heading:
            "projectTemplates:content.sales-support-desk.pages.pricingGuide.valueBands",
          starter:
            "projectTemplates:content.sales-support-desk.pages.pricingGuide.valueBandsStarter",
        },
        {
          heading:
            "projectTemplates:content.sales-support-desk.pages.pricingGuide.priority",
          starter:
            "projectTemplates:content.sales-support-desk.pages.pricingGuide.priorityStarter",
        },
        {
          heading:
            "projectTemplates:content.sales-support-desk.pages.pricingGuide.paymentTerms",
          starter:
            "projectTemplates:content.sales-support-desk.pages.pricingGuide.paymentTermsStarter",
        },
      ],
    },
    {
      key: "answer-library",
      title:
        "projectTemplates:content.sales-support-desk.pages.answerLibrary.title",
      logo: { kind: "icon", value: "BookOpen" },
      sections: [
        {
          heading:
            "projectTemplates:content.sales-support-desk.pages.answerLibrary.howToUse",
          starter:
            "projectTemplates:content.sales-support-desk.pages.answerLibrary.howToUseStarter",
        },
        {
          heading:
            "projectTemplates:content.sales-support-desk.pages.answerLibrary.security",
          starter:
            "projectTemplates:content.sales-support-desk.pages.answerLibrary.securityStarter",
        },
        {
          heading:
            "projectTemplates:content.sales-support-desk.pages.answerLibrary.privacy",
          starter: "-",
        },
        {
          heading:
            "projectTemplates:content.sales-support-desk.pages.answerLibrary.product",
          starter: "-",
        },
      ],
    },
    {
      key: "how-to-ask",
      title: "projectTemplates:content.sales-support-desk.pages.howToAsk.title",
      logo: { kind: "icon", value: "MessageSquare" },
      sections: [
        {
          heading: "projectTemplates:common.pages.whatToInclude",
          starter:
            "projectTemplates:content.sales-support-desk.pages.howToAsk.includeStarter",
        },
        {
          heading: "projectTemplates:common.pages.leadTimes",
          starter:
            "projectTemplates:content.sales-support-desk.pages.howToAsk.leadTimesStarter",
        },
      ],
    },
  ],

  sample: {
    tasks: [
      {
        key: "discount",
        title: "projectTemplates:content.sales-support-desk.samples.discount",
        description:
          "projectTemplates:content.sales-support-desk.samples.discountDescription",
        column: "awaiting-approval",
        priority: "high",
        labels: ["non-standard-terms"],
        assignee: "creator",
        dueInDays: 5,
        customFields: {
          "request-type": "discount",
          "deal-value": "120000",
          account:
            "projectTemplates:content.sales-support-desk.samples.accounts.retail",
        },
      },
      {
        key: "quote",
        title: "projectTemplates:content.sales-support-desk.samples.quote",
        column: "done",
        priority: "medium",
        customFields: {
          "request-type": "quote",
          "deal-value": "18000",
          account:
            "projectTemplates:content.sales-support-desk.samples.accounts.agency",
        },
      },
      {
        key: "security",
        title: "projectTemplates:content.sales-support-desk.samples.security",
        description:
          "projectTemplates:content.sales-support-desk.samples.securityDescription",
        column: "in-progress",
        priority: "medium",
        labels: ["strategic-deal"],
        assignee: "creator",
        startInDays: -1,
        dueInDays: 2,
        customFields: {
          "request-type": "security",
          "deal-value": "250000",
          account:
            "projectTemplates:content.sales-support-desk.samples.accounts.hospital",
        },
      },
      {
        key: "payment-terms",
        title:
          "projectTemplates:content.sales-support-desk.samples.paymentTerms",
        description:
          "projectTemplates:content.sales-support-desk.samples.paymentTermsDescription",
        column: "waiting-on-seller",
        priority: "medium",
        labels: ["non-standard-terms"],
        dueInDays: 4,
        customFields: {
          "request-type": "contract-review",
          "deal-value": "60000",
          account:
            "projectTemplates:content.sales-support-desk.samples.accounts.consultancy",
        },
      },
      {
        key: "tender",
        title: "projectTemplates:content.sales-support-desk.samples.tender",
        description:
          "projectTemplates:content.sales-support-desk.samples.tenderDescription",
        column: "new",
        priority: "high",
        dueInDays: 12,
        customFields: {
          "request-type": "proposal",
          "deal-value": "400000",
          account:
            "projectTemplates:content.sales-support-desk.samples.accounts.council",
        },
      },
    ],
  },
};

export default template;
