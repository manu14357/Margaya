import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/lead-tracking.md

const template: ProjectTemplate = {
  id: "lead-tracking",
  version: 1,
  categories: ["sales", "work-management"],
  icon: "Target",
  name: "projectTemplates:catalog.lead-tracking.name",
  pitch: "projectTemplates:catalog.lead-tracking.pitch",
  description: "projectTemplates:catalog.lead-tracking.description",
  suggestedKey: "LEAD",

  project: {
    description: "projectTemplates:content.lead-tracking.projectDescription",
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

  // Nurture comes first as the plan's backlog column, so the task template
  // names New explicitly; accepted form leads pick their column in triage.
  columns: [
    {
      key: "nurture",
      name: "projectTemplates:content.lead-tracking.statuses.nurture",
      group: "backlog",
    },
    {
      key: "new",
      name: "projectTemplates:common.statuses.new",
      group: "unstarted",
    },
    {
      key: "contacting",
      name: "projectTemplates:content.lead-tracking.statuses.contacting",
      group: "started",
    },
    {
      key: "in-conversation",
      name: "projectTemplates:content.lead-tracking.statuses.inConversation",
      group: "started",
    },
    {
      key: "qualified",
      name: "projectTemplates:common.statuses.qualified",
      group: "completed",
    },
    {
      key: "not-a-fit",
      name: "projectTemplates:content.lead-tracking.statuses.notAFit",
      group: "cancelled",
    },
  ],

  labels: [
    {
      key: "demo-requested",
      name: "projectTemplates:content.lead-tracking.labels.demoRequested",
      color: "purple",
    },
    {
      key: "existing-customer",
      name: "projectTemplates:content.lead-tracking.labels.existingCustomer",
      color: "green",
    },
  ],

  customFields: [
    {
      key: "company",
      name: "projectTemplates:common.fields.company",
      type: "text",
    },
    {
      key: "company-size",
      name: "projectTemplates:content.lead-tracking.fields.companySize",
      type: "dropdown",
      options: [
        {
          key: "size-1-10",
          label:
            "projectTemplates:content.lead-tracking.options.companySize.tiny",
        },
        {
          key: "size-11-50",
          label:
            "projectTemplates:content.lead-tracking.options.companySize.small",
        },
        {
          key: "size-51-200",
          label:
            "projectTemplates:content.lead-tracking.options.companySize.medium",
        },
        {
          key: "size-201-plus",
          label:
            "projectTemplates:content.lead-tracking.options.companySize.large",
        },
      ],
    },
    {
      key: "source",
      name: "projectTemplates:common.fields.source",
      type: "dropdown",
      options: [
        {
          key: "website-form",
          label:
            "projectTemplates:content.lead-tracking.options.source.websiteForm",
        },
        { key: "referral", label: "projectTemplates:common.options.referral" },
        { key: "event", label: "projectTemplates:common.options.event" },
        { key: "outbound", label: "projectTemplates:common.options.outbound" },
        {
          key: "content-download",
          label:
            "projectTemplates:content.lead-tracking.options.source.contentDownload",
        },
      ],
    },
    {
      key: "not-a-fit-reason",
      name: "projectTemplates:content.lead-tracking.fields.notAFitReason",
      type: "dropdown",
      options: [
        {
          key: "no-need",
          label:
            "projectTemplates:content.lead-tracking.options.notAFitReason.noNeed",
        },
        {
          key: "no-budget",
          label:
            "projectTemplates:content.lead-tracking.options.notAFitReason.noBudget",
        },
        {
          key: "wrong-contact",
          label:
            "projectTemplates:content.lead-tracking.options.notAFitReason.wrongContact",
        },
        {
          key: "no-reply",
          label:
            "projectTemplates:content.lead-tracking.options.notAFitReason.noReply",
        },
        {
          key: "too-small",
          label:
            "projectTemplates:content.lead-tracking.options.notAFitReason.tooSmall",
        },
      ],
    },
  ],

  views: [
    {
      name: "projectTemplates:common.views.board",
      filters: {
        root: { key: "group", operator: "notIn", values: ["cancelled"] },
      },
      display: {
        layout: "board",
        groupBy: "status",
        orderBy: { field: "priority" },
      },
    },
    {
      name: "projectTemplates:content.lead-tracking.views.followUpsDue",
      description:
        "projectTemplates:content.lead-tracking.views.followUpsDueDescription",
      filters: {
        root: {
          op: "and",
          children: [
            { key: "dueDate", operator: "in", values: ["today", "past"] },
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
      name: "projectTemplates:content.lead-tracking.views.bySource",
      display: {
        layout: "list",
        groupBy: { customField: "source" },
        orderBy: { field: "createdAt", direction: "desc" },
      },
    },
  ],

  taskTemplates: [
    {
      name: "projectTemplates:content.lead-tracking.taskTemplates.lead.name",
      description:
        "projectTemplates:content.lead-tracking.taskTemplates.lead.description",
      column: "new",
      priority: "medium",
      subtasks: [
        "projectTemplates:content.lead-tracking.subtasks.research",
        "projectTemplates:content.lead-tracking.subtasks.firstContact",
        "projectTemplates:content.lead-tracking.subtasks.secondContact",
        "projectTemplates:content.lead-tracking.subtasks.thirdContact",
        "projectTemplates:content.lead-tracking.subtasks.decide",
      ],
    },
  ],

  automationRules: [
    {
      name: "projectTemplates:content.lead-tracking.rules.replyFast",
      trigger: { type: "task_created", fromIntake: true },
      actions: [
        { type: "set_due_date", offsetDays: 1 },
        {
          type: "add_comment",
          template:
            "projectTemplates:content.lead-tracking.rules.replyFastComment",
        },
      ],
    },
    {
      name: "projectTemplates:content.lead-tracking.rules.contactingFollowUp",
      trigger: { type: "status_changed", to: ["contacting"] },
      actions: [{ type: "set_due_date", offsetDays: 2 }],
    },
    {
      name: "projectTemplates:content.lead-tracking.rules.overdueFollowUp",
      trigger: { type: "due_date_passed" },
      // Decided leads keep their last date; nobody needs a reminder for them.
      conditions: {
        op: "and",
        conditions: [
          {
            field: "status",
            op: "is_not",
            columns: ["qualified", "not-a-fit"],
          },
        ],
      },
      actions: [
        {
          type: "notify",
          roles: ["assignees"],
          message:
            "projectTemplates:content.lead-tracking.rules.overdueFollowUpMessage",
        },
      ],
    },
    {
      name: "projectTemplates:content.lead-tracking.rules.qualifiedHandoff",
      trigger: { type: "status_changed", to: ["qualified"] },
      actions: [
        {
          type: "add_comment",
          template:
            "projectTemplates:content.lead-tracking.rules.qualifiedHandoffComment",
        },
      ],
    },
  ],

  intakeForm: {
    title: "projectTemplates:content.lead-tracking.form.title",
    intro: "projectTemplates:content.lead-tracking.form.intro",
    descriptionField: "optional",
    nameField: "required",
    emailField: "required",
    customFields: ["company", "company-size"],
    confirmationMessage:
      "projectTemplates:content.lead-tracking.form.confirmation",
  },

  pages: [
    {
      key: "qualification",
      title: "projectTemplates:content.lead-tracking.pages.qualification.title",
      logo: { kind: "icon", value: "Target" },
      sections: [
        {
          heading:
            "projectTemplates:content.lead-tracking.pages.qualification.need",
          starter:
            "projectTemplates:content.lead-tracking.pages.qualification.needStarter",
        },
        {
          heading: "projectTemplates:common.pages.budget",
          starter:
            "projectTemplates:content.lead-tracking.pages.qualification.budgetStarter",
        },
        {
          heading:
            "projectTemplates:content.lead-tracking.pages.qualification.timing",
          starter:
            "projectTemplates:content.lead-tracking.pages.qualification.timingStarter",
        },
        {
          heading: "projectTemplates:common.pages.whoApproves",
          starter:
            "projectTemplates:content.lead-tracking.pages.qualification.whoApprovesStarter",
        },
      ],
    },
    {
      key: "follow-up-rhythm",
      title: "projectTemplates:content.lead-tracking.pages.rhythm.title",
      logo: { kind: "icon", value: "Calendar" },
      sections: [
        {
          heading: "projectTemplates:content.lead-tracking.pages.rhythm.day1",
          starter:
            "projectTemplates:content.lead-tracking.pages.rhythm.day1Starter",
        },
        {
          heading: "projectTemplates:content.lead-tracking.pages.rhythm.day3",
          starter:
            "projectTemplates:content.lead-tracking.pages.rhythm.day3Starter",
        },
        {
          heading: "projectTemplates:content.lead-tracking.pages.rhythm.day7",
          starter:
            "projectTemplates:content.lead-tracking.pages.rhythm.day7Starter",
        },
        {
          heading: "projectTemplates:content.lead-tracking.pages.rhythm.day14",
          starter:
            "projectTemplates:content.lead-tracking.pages.rhythm.day14Starter",
        },
      ],
    },
  ],

  sample: {
    tasks: [
      {
        key: "rowan",
        title: "projectTemplates:content.lead-tracking.samples.rowan",
        description:
          "projectTemplates:content.lead-tracking.samples.rowanDescription",
        column: "new",
        priority: "high",
        labels: ["demo-requested"],
        dueInDays: 1,
        customFields: { "company-size": "size-11-50", source: "website-form" },
      },
      {
        key: "kestrel",
        title: "projectTemplates:content.lead-tracking.samples.kestrel",
        description:
          "projectTemplates:content.lead-tracking.samples.kestrelDescription",
        column: "contacting",
        priority: "medium",
        assignee: "creator",
        dueInDays: -1,
        customFields: { "company-size": "size-51-200", source: "event" },
      },
      {
        key: "marlpit",
        title: "projectTemplates:content.lead-tracking.samples.marlpit",
        description:
          "projectTemplates:content.lead-tracking.samples.marlpitDescription",
        column: "in-conversation",
        priority: "urgent",
        assignee: "creator",
        dueInDays: 0,
        customFields: { "company-size": "size-1-10", source: "referral" },
      },
      {
        key: "thornby",
        title: "projectTemplates:content.lead-tracking.samples.thornby",
        description:
          "projectTemplates:content.lead-tracking.samples.thornbyDescription",
        column: "nurture",
        priority: "low",
        dueInDays: 60,
        customFields: {
          "company-size": "size-201-plus",
          source: "content-download",
        },
      },
      {
        key: "cindervale",
        title: "projectTemplates:content.lead-tracking.samples.cindervale",
        description:
          "projectTemplates:content.lead-tracking.samples.cindervaleDescription",
        column: "qualified",
        priority: "high",
        labels: ["existing-customer"],
        customFields: { "company-size": "size-11-50" },
      },
      {
        key: "student",
        title: "projectTemplates:content.lead-tracking.samples.student",
        column: "not-a-fit",
        priority: "no-priority",
        customFields: {
          source: "website-form",
          "not-a-fit-reason": "too-small",
        },
      },
    ],
  },
};

export default template;
