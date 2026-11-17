import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/ip-infringement.md

const CLOSED = ["completed", "cancelled"] as const;

const template: ProjectTemplate = {
  id: "ip-infringement",
  version: 1,
  categories: ["legal", "work-management"],
  icon: "Shield",
  name: "projectTemplates:catalog.ip-infringement.name",
  pitch: "projectTemplates:catalog.ip-infringement.pitch",
  description: "projectTemplates:catalog.ip-infringement.description",
  suggestedKey: "IP",
  // Enforcement work and claims against us stay with legal and a few others.
  suggestedVisibility: "restricted",

  project: {
    description: "projectTemplates:content.ip-infringement.projectDescription",
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
      key: "reported",
      name: "projectTemplates:content.ip-infringement.statuses.reported",
      group: "unstarted",
    },
    {
      key: "assessing",
      name: "projectTemplates:content.ip-infringement.statuses.assessing",
      group: "started",
    },
    {
      key: "notice-sent",
      name: "projectTemplates:content.ip-infringement.statuses.noticeSent",
      group: "started",
    },
    {
      key: "awaiting-response",
      name: "projectTemplates:content.ip-infringement.statuses.awaitingResponse",
      group: "started",
    },
    {
      key: "escalated",
      name: "projectTemplates:content.ip-infringement.statuses.escalated",
      group: "started",
    },
    {
      key: "resolved",
      name: "projectTemplates:common.statuses.resolved",
      group: "completed",
    },
    {
      key: "closed-no-action",
      name: "projectTemplates:content.ip-infringement.statuses.closedNoAction",
      group: "cancelled",
    },
  ],

  labels: [
    {
      key: "inbound-claim",
      name: "projectTemplates:content.ip-infringement.labels.inboundClaim",
      color: "purple",
    },
    {
      key: "repeat",
      name: "projectTemplates:content.ip-infringement.labels.repeat",
      color: "red",
    },
    {
      key: "counter-notice",
      name: "projectTemplates:content.ip-infringement.labels.counterNotice",
      color: "orange",
    },
  ],

  customFields: [
    {
      key: "ip-type",
      name: "projectTemplates:content.ip-infringement.fields.ipType",
      type: "dropdown",
      options: [
        {
          key: "trademark",
          label:
            "projectTemplates:content.ip-infringement.options.ipType.trademark",
        },
        {
          key: "copyright",
          label:
            "projectTemplates:content.ip-infringement.options.ipType.copyright",
        },
        {
          key: "patent",
          label:
            "projectTemplates:content.ip-infringement.options.ipType.patent",
        },
        {
          key: "design",
          label:
            "projectTemplates:content.ip-infringement.options.ipType.design",
        },
        {
          key: "trade-secret",
          label:
            "projectTemplates:content.ip-infringement.options.ipType.tradeSecret",
        },
      ],
    },
    {
      key: "where-found",
      name: "projectTemplates:content.ip-infringement.fields.whereFound",
      type: "dropdown",
      options: [
        {
          key: "marketplace",
          label:
            "projectTemplates:content.ip-infringement.options.whereFound.marketplace",
        },
        { key: "website", label: "projectTemplates:common.options.website" },
        {
          key: "social-media",
          label:
            "projectTemplates:content.ip-infringement.options.whereFound.socialMedia",
        },
        {
          key: "app-store",
          label:
            "projectTemplates:content.ip-infringement.options.whereFound.appStore",
        },
        {
          key: "physical-product",
          label:
            "projectTemplates:content.ip-infringement.options.whereFound.physicalProduct",
        },
        { key: "other", label: "projectTemplates:common.options.other" },
      ],
    },
    {
      key: "link",
      name: "projectTemplates:content.ip-infringement.fields.link",
      type: "text",
    },
    {
      key: "response-deadline",
      name: "projectTemplates:content.ip-infringement.fields.responseDeadline",
      type: "date",
    },
  ],

  views: [
    {
      name: "projectTemplates:content.ip-infringement.views.openCases",
      filters: {
        root: { key: "group", operator: "notIn", values: CLOSED },
      },
      display: {
        layout: "list",
        groupBy: "status",
        orderBy: { field: "dueDate", direction: "asc" },
      },
    },
    {
      name: "projectTemplates:content.ip-infringement.views.byIpType",
      display: {
        layout: "list",
        groupBy: { customField: "ip-type" },
        subGroupBy: "status",
      },
    },
    {
      name: "projectTemplates:common.views.deadlines",
      description:
        "projectTemplates:content.ip-infringement.views.deadlinesDescription",
      filters: {
        root: { key: "group", operator: "notIn", values: CLOSED },
      },
      display: { layout: "calendar" },
    },
  ],

  taskTemplates: [
    {
      name: "projectTemplates:content.ip-infringement.taskTemplates.caseAssessment.name",
      description:
        "projectTemplates:content.ip-infringement.taskTemplates.caseAssessment.description",
      priority: "high",
    },
    {
      name: "projectTemplates:content.ip-infringement.taskTemplates.inboundClaim.name",
      description:
        "projectTemplates:content.ip-infringement.taskTemplates.inboundClaim.description",
      priority: "urgent",
      labels: ["inbound-claim"],
    },
  ],

  automationRules: [
    {
      name: "projectTemplates:content.ip-infringement.rules.evidenceFirst",
      trigger: { type: "task_created", fromIntake: true },
      actions: [
        {
          type: "create_subtask",
          title:
            "projectTemplates:content.ip-infringement.rules.evidenceSubtask",
        },
      ],
    },
    {
      name: "projectTemplates:content.ip-infringement.rules.noticeFollowUp",
      trigger: { type: "status_changed", to: ["notice-sent"] },
      actions: [
        { type: "set_due_date", offsetDays: 14 },
        {
          type: "add_comment",
          template:
            "projectTemplates:content.ip-infringement.rules.noticeComment",
        },
      ],
    },
    {
      name: "projectTemplates:content.ip-infringement.rules.overdue",
      trigger: { type: "due_date_passed" },
      // Closed cases keep their due date; nobody needs to hear about those.
      conditions: {
        op: "and",
        conditions: [
          {
            field: "status",
            op: "is_not",
            columns: ["resolved", "closed-no-action"],
          },
        ],
      },
      actions: [
        { type: "set_priority", priority: "high" },
        {
          type: "notify",
          roles: ["lead"],
          message:
            "projectTemplates:content.ip-infringement.rules.overdueMessage",
        },
      ],
    },
    {
      name: "projectTemplates:content.ip-infringement.rules.inboundClaim",
      trigger: { type: "label_added", labels: ["inbound-claim"] },
      actions: [
        { type: "set_priority", priority: "urgent" },
        {
          type: "notify",
          roles: ["lead"],
          message:
            "projectTemplates:content.ip-infringement.rules.inboundClaimMessage",
        },
      ],
    },
  ],

  intakeForm: {
    title: "projectTemplates:content.ip-infringement.form.title",
    intro: "projectTemplates:content.ip-infringement.form.intro",
    descriptionField: "optional",
    emailField: "required",
    nameField: "optional",
    customFields: ["ip-type", "where-found", "link"],
    confirmationMessage:
      "projectTemplates:content.ip-infringement.form.confirmation",
  },

  pages: [
    {
      key: "playbook",
      title: "projectTemplates:content.ip-infringement.pages.playbook.title",
      logo: { kind: "icon", value: "BookOpen" },
      sections: [
        {
          heading:
            "projectTemplates:content.ip-infringement.pages.playbook.protect",
          starter:
            "projectTemplates:content.ip-infringement.pages.playbook.protectStarter",
        },
        {
          heading:
            "projectTemplates:content.ip-infringement.pages.playbook.evidence",
          starter:
            "projectTemplates:content.ip-infringement.pages.playbook.evidenceStarter",
        },
        {
          heading:
            "projectTemplates:content.ip-infringement.pages.playbook.ladder",
          starter:
            "projectTemplates:content.ip-infringement.pages.playbook.ladderStarter",
        },
        {
          heading:
            "projectTemplates:content.ip-infringement.pages.playbook.whoSends",
          starter:
            "projectTemplates:content.ip-infringement.pages.playbook.whoSendsStarter",
        },
        {
          heading:
            "projectTemplates:content.ip-infringement.pages.playbook.counsel",
          starter:
            "projectTemplates:content.ip-infringement.pages.playbook.counselStarter",
        },
        {
          heading:
            "projectTemplates:content.ip-infringement.pages.playbook.repeat",
          starter:
            "projectTemplates:content.ip-infringement.pages.playbook.repeatStarter",
        },
      ],
    },
  ],

  sample: {
    tasks: [
      {
        key: "mugs",
        title: "projectTemplates:content.ip-infringement.samples.mugs",
        description:
          "projectTemplates:content.ip-infringement.samples.mugsDescription",
        column: "awaiting-response",
        priority: "medium",
        assignee: "creator",
        dueInDays: 9,
        customFields: { "ip-type": "trademark", "where-found": "marketplace" },
      },
      {
        key: "blog-guide",
        title: "projectTemplates:content.ip-infringement.samples.blogGuide",
        description:
          "projectTemplates:content.ip-infringement.samples.blogGuideDescription",
        column: "assessing",
        priority: "medium",
        customFields: { "ip-type": "copyright", "where-found": "website" },
        subtasks: [
          "projectTemplates:content.ip-infringement.rules.evidenceSubtask",
        ],
      },
      {
        key: "chargers",
        title: "projectTemplates:content.ip-infringement.samples.chargers",
        description:
          "projectTemplates:content.ip-infringement.samples.chargersDescription",
        column: "escalated",
        priority: "high",
        labels: ["repeat"],
        customFields: {
          "ip-type": "trademark",
          "where-found": "physical-product",
        },
      },
      {
        key: "product-photos",
        title: "projectTemplates:content.ip-infringement.samples.productPhotos",
        column: "notice-sent",
        priority: "low",
        dueInDays: 12,
        customFields: { "ip-type": "copyright", "where-found": "social-media" },
      },
      {
        key: "icon-set",
        title: "projectTemplates:content.ip-infringement.samples.iconSet",
        description:
          "projectTemplates:content.ip-infringement.samples.iconSetDescription",
        column: "assessing",
        priority: "urgent",
        labels: ["inbound-claim"],
        assignee: "creator",
        dueInDays: 10,
        customFields: { "ip-type": "copyright" },
      },
      {
        key: "reseller",
        title: "projectTemplates:content.ip-infringement.samples.reseller",
        description:
          "projectTemplates:content.ip-infringement.samples.resellerDescription",
        column: "closed-no-action",
        priority: "low",
        customFields: { "ip-type": "trademark", "where-found": "website" },
      },
    ],
  },
};

export default template;
