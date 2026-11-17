import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/legal-request-desk.md

const OPEN = ["unstarted", "started"] as const;

const template: ProjectTemplate = {
  id: "legal-request-desk",
  version: 1,
  categories: ["service-management", "legal"],
  icon: "Briefcase",
  name: "projectTemplates:catalog.legal-request-desk.name",
  pitch: "projectTemplates:catalog.legal-request-desk.pitch",
  description: "projectTemplates:catalog.legal-request-desk.description",
  suggestedKey: "LEGAL",
  // Legal advice and disputes should stay with the legal team.
  suggestedVisibility: "restricted",

  project: {
    description:
      "projectTemplates:content.legal-request-desk.projectDescription",
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
      key: "in-review",
      name: "projectTemplates:common.statuses.inReview",
      group: "started",
    },
    {
      key: "waiting-on-requester",
      name: "projectTemplates:common.statuses.waitingOnRequester",
      group: "started",
    },
    {
      key: "with-counterparty",
      name: "projectTemplates:content.legal-request-desk.statuses.withCounterparty",
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
      key: "standard-terms",
      name: "projectTemplates:content.legal-request-desk.labels.standardTerms",
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
      key: "request-type",
      name: "projectTemplates:common.fields.requestType",
      type: "dropdown",
      options: [
        {
          key: "confidentiality",
          label:
            "projectTemplates:content.legal-request-desk.options.requestType.confidentiality",
        },
        {
          key: "contract-review",
          label: "projectTemplates:common.options.contractReview",
        },
        {
          key: "new-draft",
          label:
            "projectTemplates:content.legal-request-desk.options.requestType.newDraft",
        },
        {
          key: "policy-question",
          label:
            "projectTemplates:content.legal-request-desk.options.requestType.policyQuestion",
        },
        {
          key: "dispute",
          label:
            "projectTemplates:content.legal-request-desk.options.requestType.dispute",
        },
        { key: "other", label: "projectTemplates:common.options.other" },
      ],
      defaultOption: "other",
    },
    {
      key: "counterparty",
      name: "projectTemplates:content.legal-request-desk.fields.counterparty",
      type: "text",
    },
    {
      key: "contract-value",
      name: "projectTemplates:content.legal-request-desk.fields.contractValue",
      type: "number",
    },
    {
      key: "needed-by",
      name: "projectTemplates:common.fields.neededBy",
      type: "date",
    },
  ],

  views: [
    {
      name: "projectTemplates:content.legal-request-desk.views.myMatters",
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
      name: "projectTemplates:common.views.dueSoon",
      description:
        "projectTemplates:content.legal-request-desk.views.dueSoonDescription",
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
      name: "projectTemplates:content.legal-request-desk.views.byType",
      filters: {
        root: { key: "group", operator: "in", values: OPEN },
      },
      display: {
        layout: "board",
        groupBy: { customField: "request-type" },
      },
    },
  ],

  taskTemplates: [
    {
      name: "projectTemplates:content.legal-request-desk.taskTemplates.confidentiality.name",
      description:
        "projectTemplates:content.legal-request-desk.taskTemplates.confidentiality.description",
      priority: "low",
      labels: ["standard-terms"],
    },
    {
      name: "projectTemplates:content.legal-request-desk.taskTemplates.contractReview.name",
      description:
        "projectTemplates:content.legal-request-desk.taskTemplates.contractReview.description",
      priority: "medium",
    },
    {
      name: "projectTemplates:content.legal-request-desk.taskTemplates.newDraft.name",
      description:
        "projectTemplates:content.legal-request-desk.taskTemplates.newDraft.description",
      priority: "medium",
    },
    {
      name: "projectTemplates:content.legal-request-desk.taskTemplates.policyQuestion.name",
      description:
        "projectTemplates:content.legal-request-desk.taskTemplates.policyQuestion.description",
      priority: "low",
    },
    {
      name: "projectTemplates:content.legal-request-desk.taskTemplates.dispute.name",
      description:
        "projectTemplates:content.legal-request-desk.taskTemplates.dispute.description",
      priority: "urgent",
      labels: ["high-risk"],
    },
  ],

  automationRules: [
    {
      name: "projectTemplates:content.legal-request-desk.rules.disputesToLead",
      trigger: { type: "task_created", fromIntake: true },
      conditions: {
        op: "and",
        conditions: [
          {
            field: "custom_field",
            fieldKey: "request-type",
            op: "equals",
            value: "dispute",
          },
        ],
      },
      actions: [
        { type: "set_priority", priority: "urgent" },
        { type: "add_label", label: "high-risk" },
        {
          type: "notify",
          roles: ["lead"],
          message:
            "projectTemplates:content.legal-request-desk.rules.disputeMessage",
        },
      ],
    },
    {
      name: "projectTemplates:content.legal-request-desk.rules.lateOwner",
      trigger: { type: "due_date_passed" },
      // Closed matters keep their due date; nobody needs to hear about those.
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
            "projectTemplates:content.legal-request-desk.rules.lateMessage",
        },
      ],
    },
  ],

  intakeForm: {
    title: "projectTemplates:content.legal-request-desk.form.title",
    intro: "projectTemplates:content.legal-request-desk.form.intro",
    descriptionField: "required",
    emailField: "required",
    nameField: "required",
    customFields: [
      "request-type",
      "counterparty",
      "contract-value",
      "needed-by",
    ],
    confirmationMessage:
      "projectTemplates:content.legal-request-desk.form.confirmation",
  },

  pages: [
    {
      key: "when-to-ask",
      title:
        "projectTemplates:content.legal-request-desk.pages.whenToAsk.title",
      logo: { kind: "icon", value: "MessageSquare" },
      sections: [
        {
          heading:
            "projectTemplates:content.legal-request-desk.pages.whenToAsk.needsReview",
          starter:
            "projectTemplates:content.legal-request-desk.pages.whenToAsk.needsReviewStarter",
        },
        {
          heading:
            "projectTemplates:content.legal-request-desk.pages.whenToAsk.noReview",
          starter:
            "projectTemplates:content.legal-request-desk.pages.whenToAsk.noReviewStarter",
        },
        {
          heading:
            "projectTemplates:content.legal-request-desk.pages.whenToAsk.selfServe",
          starter:
            "projectTemplates:content.legal-request-desk.pages.whenToAsk.selfServeStarter",
        },
        {
          heading:
            "projectTemplates:content.legal-request-desk.pages.whenToAsk.priority",
          starter:
            "projectTemplates:content.legal-request-desk.pages.whenToAsk.priorityStarter",
        },
      ],
    },
    {
      key: "playbook",
      title: "projectTemplates:content.legal-request-desk.pages.playbook.title",
      logo: { kind: "icon", value: "BookOpen" },
      sections: [
        {
          heading:
            "projectTemplates:content.legal-request-desk.pages.playbook.standard",
          starter:
            "projectTemplates:content.legal-request-desk.pages.playbook.standardStarter",
        },
        {
          heading:
            "projectTemplates:content.legal-request-desk.pages.playbook.fallbacks",
          starter:
            "projectTemplates:content.legal-request-desk.pages.playbook.fallbacksStarter",
        },
        {
          heading:
            "projectTemplates:content.legal-request-desk.pages.playbook.walkAway",
          starter:
            "projectTemplates:content.legal-request-desk.pages.playbook.walkAwayStarter",
        },
      ],
    },
    {
      key: "who-can-sign",
      title:
        "projectTemplates:content.legal-request-desk.pages.whoCanSign.title",
      logo: { kind: "icon", value: "PenTool" },
      sections: [
        {
          heading:
            "projectTemplates:content.legal-request-desk.pages.whoCanSign.byType",
          starter:
            "projectTemplates:content.legal-request-desk.pages.whoCanSign.byTypeStarter",
        },
        {
          heading:
            "projectTemplates:content.legal-request-desk.pages.whoCanSign.byValue",
          starter:
            "projectTemplates:content.legal-request-desk.pages.whoCanSign.byValueStarter",
        },
      ],
    },
    {
      key: "questions",
      title:
        "projectTemplates:content.legal-request-desk.pages.questions.title",
      logo: { kind: "icon", value: "Lightbulb" },
      sections: [
        {
          heading:
            "projectTemplates:content.legal-request-desk.pages.questions.gifts",
          starter:
            "projectTemplates:content.legal-request-desk.pages.questions.giftsStarter",
        },
        {
          heading:
            "projectTemplates:content.legal-request-desk.pages.questions.dataSharing",
          starter:
            "projectTemplates:content.legal-request-desk.pages.questions.dataSharingStarter",
        },
        {
          heading:
            "projectTemplates:content.legal-request-desk.pages.questions.logos",
          starter:
            "projectTemplates:content.legal-request-desk.pages.questions.logosStarter",
        },
      ],
    },
  ],

  sample: {
    tasks: [
      {
        key: "partner-nda",
        title: "projectTemplates:content.legal-request-desk.samples.partnerNda",
        description:
          "projectTemplates:content.legal-request-desk.samples.partnerNdaDescription",
        column: "with-counterparty",
        priority: "medium",
        labels: ["standard-terms"],
        dueInDays: 3,
        customFields: {
          "request-type": "confidentiality",
          counterparty:
            "projectTemplates:content.legal-request-desk.samples.partnerName",
        },
      },
      {
        key: "catering-contract",
        title:
          "projectTemplates:content.legal-request-desk.samples.cateringContract",
        description:
          "projectTemplates:content.legal-request-desk.samples.cateringContractDescription",
        column: "in-review",
        priority: "high",
        labels: ["high-risk"],
        assignee: "creator",
        dueInDays: 5,
        customFields: {
          "request-type": "contract-review",
          counterparty:
            "projectTemplates:content.legal-request-desk.samples.cateringName",
          "contract-value": "40000",
        },
      },
      {
        key: "supplier-gift",
        title:
          "projectTemplates:content.legal-request-desk.samples.supplierGift",
        column: "done",
        priority: "low",
        customFields: { "request-type": "policy-question" },
      },
      {
        key: "refund-claim",
        title:
          "projectTemplates:content.legal-request-desk.samples.refundClaim",
        description:
          "projectTemplates:content.legal-request-desk.samples.refundClaimDescription",
        column: "waiting-on-requester",
        priority: "high",
        dueInDays: 2,
        customFields: { "request-type": "dispute" },
      },
      {
        key: "reseller-agreement",
        title:
          "projectTemplates:content.legal-request-desk.samples.resellerAgreement",
        column: "new",
        priority: "medium",
        dueInDays: 14,
        customFields: { "request-type": "new-draft" },
      },
    ],
  },
};

export default template;
