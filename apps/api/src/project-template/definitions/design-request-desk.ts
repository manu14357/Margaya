import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/design-request-desk.md

const template: ProjectTemplate = {
  id: "design-request-desk",
  version: 1,
  categories: ["service-management", "design"],
  icon: "Palette",
  name: "projectTemplates:catalog.design-request-desk.name",
  pitch: "projectTemplates:catalog.design-request-desk.pitch",
  description: "projectTemplates:catalog.design-request-desk.description",
  suggestedKey: "DES",

  project: {
    description:
      "projectTemplates:content.design-request-desk.projectDescription",
    features: {
      cycles: false,
      modules: false,
      views: true,
      pages: true,
      whiteboards: false,
      intake: true,
      estimates: true,
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
      key: "brand",
      name: "projectTemplates:content.design-request-desk.labels.brand",
      color: "purple",
    },
    {
      key: "quick-fix",
      name: "projectTemplates:content.design-request-desk.labels.quickFix",
      color: "green",
    },
  ],

  customFields: [
    {
      key: "request-type",
      name: "projectTemplates:common.fields.requestType",
      type: "dropdown",
      options: [
        {
          key: "social",
          label:
            "projectTemplates:content.design-request-desk.options.requestType.social",
        },
        {
          key: "slides",
          label:
            "projectTemplates:content.design-request-desk.options.requestType.slides",
        },
        { key: "print", label: "projectTemplates:common.options.print" },
        {
          key: "web",
          label:
            "projectTemplates:content.design-request-desk.options.requestType.web",
        },
        {
          key: "product-ui",
          label:
            "projectTemplates:content.design-request-desk.options.requestType.productUi",
        },
        {
          key: "illustration",
          label:
            "projectTemplates:content.design-request-desk.options.requestType.illustration",
        },
        { key: "other", label: "projectTemplates:common.options.other" },
      ],
      defaultOption: "other",
    },
    {
      key: "formats",
      name: "projectTemplates:content.design-request-desk.fields.formats",
      type: "text",
    },
    {
      key: "needed-by",
      name: "projectTemplates:common.fields.neededBy",
      type: "date",
    },
    {
      key: "review-rounds",
      name: "projectTemplates:content.design-request-desk.fields.reviewRounds",
      type: "number",
      defaultValue: "0",
    },
  ],

  estimate: {
    name: "projectTemplates:content.design-request-desk.estimate.name",
    type: "points",
    values: ["1", "2", "3", "5", "8"],
  },

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
      description:
        "projectTemplates:content.design-request-desk.views.dueSoonDescription",
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
      name: "projectTemplates:common.views.designBoard",
      filters: {
        root: { key: "group", operator: "notIn", values: ["cancelled"] },
      },
      display: {
        layout: "board",
        groupBy: "status",
        orderBy: { field: "dueDate", direction: "asc" },
      },
      displayProperties: {
        estimate: true,
        customFields: ["request-type", "review-rounds"],
      },
    },
  ],

  intakeForm: {
    title: "projectTemplates:content.design-request-desk.form.title",
    intro: "projectTemplates:content.design-request-desk.form.intro",
    descriptionField: "required",
    emailField: "required",
    nameField: "required",
    customFields: ["request-type", "formats", "needed-by"],
    confirmationMessage:
      "projectTemplates:content.design-request-desk.form.confirmation",
  },

  taskTemplates: [
    {
      name: "projectTemplates:content.design-request-desk.taskTemplates.social.name",
      description:
        "projectTemplates:content.design-request-desk.taskTemplates.social.description",
      priority: "low",
    },
    {
      name: "projectTemplates:content.design-request-desk.taskTemplates.slides.name",
      description:
        "projectTemplates:content.design-request-desk.taskTemplates.slides.description",
      priority: "medium",
    },
    {
      name: "projectTemplates:content.design-request-desk.taskTemplates.print.name",
      description:
        "projectTemplates:content.design-request-desk.taskTemplates.print.description",
      priority: "medium",
    },
    {
      name: "projectTemplates:content.design-request-desk.taskTemplates.productUi.name",
      description:
        "projectTemplates:content.design-request-desk.taskTemplates.productUi.description",
      priority: "high",
    },
    {
      name: "projectTemplates:content.design-request-desk.taskTemplates.illustration.name",
      description:
        "projectTemplates:content.design-request-desk.taskTemplates.illustration.description",
      priority: "medium",
      labels: ["brand"],
    },
  ],

  automationRules: [
    {
      name: "projectTemplates:content.design-request-desk.rules.askForFeedback",
      trigger: { type: "status_changed", to: ["in-review"] },
      actions: [
        {
          type: "add_comment",
          template:
            "projectTemplates:content.design-request-desk.rules.askForFeedbackComment",
        },
      ],
    },
    {
      name: "projectTemplates:content.design-request-desk.rules.lateNotice",
      trigger: { type: "due_date_passed" },
      actions: [
        {
          type: "notify",
          roles: ["assignees"],
          message:
            "projectTemplates:content.design-request-desk.rules.lateNoticeMessage",
        },
      ],
    },
  ],

  pages: [
    {
      key: "how-to-request",
      title:
        "projectTemplates:content.design-request-desk.pages.howToRequest.title",
      logo: { kind: "icon", value: "BookOpen" },
      sections: [
        {
          heading: "projectTemplates:common.pages.leadTimes",
          starter:
            "projectTemplates:content.design-request-desk.pages.howToRequest.leadTimesStarter",
        },
        {
          heading: "projectTemplates:common.pages.whatToInclude",
          starter:
            "projectTemplates:content.design-request-desk.pages.howToRequest.whatToIncludeStarter",
        },
        {
          heading:
            "projectTemplates:content.design-request-desk.pages.howToRequest.priority",
          starter:
            "projectTemplates:content.design-request-desk.pages.howToRequest.priorityStarter",
        },
        {
          heading:
            "projectTemplates:content.design-request-desk.pages.howToRequest.reviews",
          starter:
            "projectTemplates:content.design-request-desk.pages.howToRequest.reviewsStarter",
        },
      ],
    },
    {
      key: "design-system",
      title:
        "projectTemplates:content.design-request-desk.pages.designSystem.title",
      logo: { kind: "icon", value: "Palette" },
      sections: [
        {
          heading:
            "projectTemplates:content.design-request-desk.pages.designSystem.colours",
          starter: "-",
        },
        {
          heading:
            "projectTemplates:content.design-request-desk.pages.designSystem.type",
          starter: "-",
        },
        {
          heading:
            "projectTemplates:content.design-request-desk.pages.designSystem.logo",
          starter:
            "projectTemplates:content.design-request-desk.pages.designSystem.logoStarter",
        },
        {
          heading:
            "projectTemplates:content.design-request-desk.pages.designSystem.components",
          starter: "-",
        },
        {
          heading:
            "projectTemplates:content.design-request-desk.pages.designSystem.files",
          starter:
            "projectTemplates:content.design-request-desk.pages.designSystem.filesStarter",
        },
      ],
    },
    {
      key: "hand-off",
      title: "projectTemplates:content.design-request-desk.pages.handOff.title",
      logo: { kind: "icon", value: "List" },
      sections: [
        {
          heading:
            "projectTemplates:content.design-request-desk.pages.handOff.formats",
          starter:
            "projectTemplates:content.design-request-desk.pages.handOff.formatsStarter",
        },
        {
          heading:
            "projectTemplates:content.design-request-desk.pages.handOff.naming",
          starter:
            "projectTemplates:content.design-request-desk.pages.handOff.namingStarter",
        },
        {
          heading:
            "projectTemplates:content.design-request-desk.pages.handOff.storage",
          starter:
            "projectTemplates:content.design-request-desk.pages.handOff.storageStarter",
        },
      ],
    },
  ],

  sample: {
    tasks: [
      {
        key: "webinar-banners",
        title:
          "projectTemplates:content.design-request-desk.samples.webinarBanners",
        description:
          "projectTemplates:content.design-request-desk.samples.webinarBannersDescription",
        column: "in-review",
        priority: "high",
        assignee: "creator",
        startInDays: -4,
        dueInDays: 6,
        estimateValue: "3",
        customFields: {
          "request-type": "social",
          formats:
            "projectTemplates:content.design-request-desk.samples.webinarBannersFormats",
          "review-rounds": "1",
        },
      },
      {
        key: "settings-icons",
        title:
          "projectTemplates:content.design-request-desk.samples.settingsIcons",
        description:
          "projectTemplates:content.design-request-desk.samples.settingsIconsDescription",
        column: "in-progress",
        priority: "medium",
        labels: ["brand"],
        startInDays: -2,
        dueInDays: 8,
        estimateValue: "5",
        customFields: { "request-type": "illustration" },
      },
      {
        key: "sales-deck",
        title: "projectTemplates:content.design-request-desk.samples.salesDeck",
        column: "up-next",
        priority: "medium",
        dueInDays: 15,
        estimateValue: "5",
        customFields: { "request-type": "slides" },
      },
      {
        key: "poster-typo",
        title:
          "projectTemplates:content.design-request-desk.samples.posterTypo",
        column: "delivered",
        priority: "low",
        labels: ["quick-fix"],
        dueInDays: -1,
        estimateValue: "1",
        customFields: { "request-type": "print" },
      },
      {
        key: "onboarding-screens",
        title:
          "projectTemplates:content.design-request-desk.samples.onboardingScreens",
        column: "up-next",
        priority: "high",
        dueInDays: 21,
        estimateValue: "8",
        customFields: { "request-type": "product-ui" },
        relations: [{ type: "related", to: "settings-icons" }],
      },
    ],
  },
};

export default template;
