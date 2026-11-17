import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/marketing-request-desk.md

const template: ProjectTemplate = {
  id: "marketing-request-desk",
  version: 1,
  categories: ["service-management", "marketing"],
  icon: "Radio",
  name: "projectTemplates:catalog.marketing-request-desk.name",
  pitch: "projectTemplates:catalog.marketing-request-desk.pitch",
  description: "projectTemplates:catalog.marketing-request-desk.description",
  suggestedKey: "MKT",

  project: {
    description:
      "projectTemplates:content.marketing-request-desk.projectDescription",
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
      key: "up-next",
      name: "projectTemplates:common.statuses.upNext",
      group: "unstarted",
    },
    {
      key: "in-progress",
      name: "projectTemplates:common.statuses.inProgress",
      group: "started",
    },
    {
      key: "in-review",
      name: "projectTemplates:common.statuses.inReview",
      group: "started",
    },
    {
      key: "delivered",
      name: "projectTemplates:common.statuses.delivered",
      group: "completed",
    },
    {
      key: "wont-do",
      name: "projectTemplates:common.statuses.wontDo",
      group: "cancelled",
    },
  ],

  labels: [
    {
      key: "launch",
      name: "projectTemplates:content.marketing-request-desk.labels.launch",
      color: "purple",
    },
    {
      key: "needs-design",
      name: "projectTemplates:common.labels.needsDesign",
      color: "pink",
    },
  ],

  customFields: [
    {
      key: "request-type",
      name: "projectTemplates:common.fields.requestType",
      type: "dropdown",
      options: [
        {
          key: "social-post",
          label:
            "projectTemplates:content.marketing-request-desk.options.requestType.socialPost",
        },
        { key: "email", label: "projectTemplates:common.options.email" },
        {
          key: "web-page",
          label:
            "projectTemplates:content.marketing-request-desk.options.requestType.webPage",
        },
        {
          key: "event-support",
          label:
            "projectTemplates:content.marketing-request-desk.options.requestType.eventSupport",
        },
        {
          key: "printed",
          label:
            "projectTemplates:content.marketing-request-desk.options.requestType.printed",
        },
        {
          key: "campaign",
          label:
            "projectTemplates:content.marketing-request-desk.options.requestType.campaign",
        },
        { key: "other", label: "projectTemplates:common.options.other" },
      ],
      defaultOption: "other",
    },
    {
      key: "audience",
      name: "projectTemplates:content.marketing-request-desk.fields.audience",
      type: "text",
    },
    {
      key: "reach",
      name: "projectTemplates:common.fields.reach",
      type: "dropdown",
      options: [
        {
          key: "internal",
          label:
            "projectTemplates:content.marketing-request-desk.options.reach.internal",
        },
        {
          key: "customers",
          label:
            "projectTemplates:content.marketing-request-desk.options.reach.customers",
        },
        {
          key: "public",
          label:
            "projectTemplates:content.marketing-request-desk.options.reach.public",
        },
      ],
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
            { key: "group", operator: "in", values: ["unstarted", "started"] },
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
            { key: "group", operator: "in", values: ["unstarted", "started"] },
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
      name: "projectTemplates:common.views.dueSoon",
      filters: {
        root: {
          op: "and",
          children: [
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
            { key: "group", operator: "in", values: ["unstarted", "started"] },
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
      name: "projectTemplates:content.marketing-request-desk.views.publishingCalendar",
      description:
        "projectTemplates:content.marketing-request-desk.views.publishingCalendarDescription",
      filters: {
        root: { key: "group", operator: "notIn", values: ["cancelled"] },
      },
      display: { layout: "calendar", groupBy: null },
    },
  ],

  intakeForm: {
    title: "projectTemplates:content.marketing-request-desk.form.title",
    intro: "projectTemplates:content.marketing-request-desk.form.intro",
    descriptionField: "required",
    emailField: "required",
    nameField: "required",
    customFields: ["request-type", "audience", "reach", "needed-by"],
    confirmationMessage:
      "projectTemplates:content.marketing-request-desk.form.confirmation",
  },

  taskTemplates: [
    {
      name: "projectTemplates:content.marketing-request-desk.taskTemplates.socialPost.name",
      description:
        "projectTemplates:content.marketing-request-desk.taskTemplates.socialPost.description",
      priority: "low",
    },
    {
      name: "projectTemplates:content.marketing-request-desk.taskTemplates.email.name",
      description:
        "projectTemplates:content.marketing-request-desk.taskTemplates.email.description",
      priority: "medium",
    },
    {
      name: "projectTemplates:content.marketing-request-desk.taskTemplates.webPage.name",
      description:
        "projectTemplates:content.marketing-request-desk.taskTemplates.webPage.description",
      priority: "medium",
    },
    {
      name: "projectTemplates:content.marketing-request-desk.taskTemplates.eventSupport.name",
      description:
        "projectTemplates:content.marketing-request-desk.taskTemplates.eventSupport.description",
      priority: "medium",
    },
    {
      name: "projectTemplates:content.marketing-request-desk.taskTemplates.campaignKickoff.name",
      description:
        "projectTemplates:content.marketing-request-desk.taskTemplates.campaignKickoff.description",
      priority: "high",
      labels: ["launch"],
      subtasks: [
        "projectTemplates:content.marketing-request-desk.subtasks.briefSignedOff",
        "projectTemplates:content.marketing-request-desk.subtasks.channelPlan",
        "projectTemplates:content.marketing-request-desk.subtasks.assetsList",
        "projectTemplates:content.marketing-request-desk.subtasks.launchDayChecklist",
        "projectTemplates:content.marketing-request-desk.subtasks.resultsReview",
      ],
    },
  ],

  automationRules: [
    {
      name: "projectTemplates:content.marketing-request-desk.rules.askForReview",
      trigger: { type: "status_changed", to: ["in-review"] },
      actions: [
        {
          type: "add_comment",
          template:
            "projectTemplates:content.marketing-request-desk.rules.askForReviewComment",
        },
      ],
    },
    {
      name: "projectTemplates:content.marketing-request-desk.rules.lateOwner",
      trigger: { type: "due_date_passed" },
      actions: [
        {
          type: "notify",
          roles: ["assignees"],
          message:
            "projectTemplates:content.marketing-request-desk.rules.lateMessage",
        },
      ],
    },
  ],

  pages: [
    {
      key: "how-to-brief",
      title:
        "projectTemplates:content.marketing-request-desk.pages.howToBrief.title",
      logo: { kind: "icon", value: "BookOpen" },
      sections: [
        {
          heading: "projectTemplates:common.pages.whatToInclude",
          starter:
            "projectTemplates:content.marketing-request-desk.pages.howToBrief.whatToIncludeStarter",
        },
        {
          heading: "projectTemplates:common.pages.leadTimes",
          starter:
            "projectTemplates:content.marketing-request-desk.pages.howToBrief.leadTimesStarter",
        },
        {
          heading:
            "projectTemplates:content.marketing-request-desk.pages.howToBrief.priority",
          starter:
            "projectTemplates:content.marketing-request-desk.pages.howToBrief.priorityStarter",
        },
        {
          heading: "projectTemplates:common.pages.whatHappensNext",
          starter:
            "projectTemplates:content.marketing-request-desk.pages.howToBrief.whatHappensNextStarter",
        },
      ],
    },
    {
      key: "brand-basics",
      title: "projectTemplates:common.pages.brandBasics",
      logo: { kind: "icon", value: "Palette" },
      sections: [
        {
          heading:
            "projectTemplates:content.marketing-request-desk.pages.brandBasics.voice",
          starter:
            "projectTemplates:content.marketing-request-desk.pages.brandBasics.voiceStarter",
        },
        {
          heading:
            "projectTemplates:content.marketing-request-desk.pages.brandBasics.words",
          starter: "-",
        },
        {
          heading:
            "projectTemplates:content.marketing-request-desk.pages.brandBasics.logoAndColour",
          starter:
            "projectTemplates:content.marketing-request-desk.pages.brandBasics.logoAndColourStarter",
        },
      ],
    },
    {
      key: "channel-calendar",
      title:
        "projectTemplates:content.marketing-request-desk.pages.channelCalendar.title",
      logo: { kind: "icon", value: "Calendar" },
      sections: [
        {
          heading: "projectTemplates:common.pages.channels",
          starter:
            "projectTemplates:content.marketing-request-desk.pages.channelCalendar.channelsStarter",
        },
        {
          heading:
            "projectTemplates:content.marketing-request-desk.pages.channelCalendar.blackoutDates",
          starter: "-",
        },
      ],
    },
  ],

  sample: {
    tasks: [
      {
        key: "feature-email",
        title:
          "projectTemplates:content.marketing-request-desk.samples.featureEmail",
        description:
          "projectTemplates:content.marketing-request-desk.samples.featureEmailDescription",
        column: "in-review",
        priority: "high",
        labels: ["launch"],
        assignee: "creator",
        startInDays: -4,
        dueInDays: 3,
        customFields: {
          "request-type": "email",
          audience:
            "projectTemplates:content.marketing-request-desk.samples.featureEmailAudience",
          reach: "customers",
        },
      },
      {
        key: "trade-show-handout",
        title:
          "projectTemplates:content.marketing-request-desk.samples.tradeShowHandout",
        description:
          "projectTemplates:content.marketing-request-desk.samples.tradeShowHandoutDescription",
        column: "up-next",
        priority: "medium",
        labels: ["needs-design"],
        customFields: {
          "request-type": "printed",
          audience:
            "projectTemplates:content.marketing-request-desk.samples.tradeShowHandoutAudience",
          reach: "public",
        },
      },
      {
        key: "school-story",
        title:
          "projectTemplates:content.marketing-request-desk.samples.schoolStory",
        column: "in-progress",
        priority: "medium",
        assignee: "creator",
        startInDays: -2,
        dueInDays: 8,
        customFields: {
          "request-type": "web-page",
          reach: "public",
        },
      },
      {
        key: "webinar-posts",
        title:
          "projectTemplates:content.marketing-request-desk.samples.webinarPosts",
        column: "up-next",
        priority: "low",
        dueInDays: 12,
        customFields: {
          "request-type": "social-post",
          reach: "public",
        },
      },
      {
        key: "office-newsletter",
        title:
          "projectTemplates:content.marketing-request-desk.samples.officeNewsletter",
        column: "delivered",
        priority: "low",
        dueInDays: -3,
        customFields: {
          "request-type": "email",
          audience:
            "projectTemplates:content.marketing-request-desk.samples.officeNewsletterAudience",
          reach: "internal",
        },
      },
    ],
  },
};

export default template;
