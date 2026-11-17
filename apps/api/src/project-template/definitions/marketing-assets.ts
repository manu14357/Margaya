import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/marketing-assets.md

const template: ProjectTemplate = {
  id: "marketing-assets",
  version: 1,
  categories: ["design", "work-management"],
  icon: "Image",
  name: "projectTemplates:catalog.marketing-assets.name",
  pitch: "projectTemplates:catalog.marketing-assets.pitch",
  description: "projectTemplates:catalog.marketing-assets.description",
  suggestedKey: "ASSET",

  project: {
    description: "projectTemplates:content.marketing-assets.projectDescription",
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
      key: "todo",
      name: "projectTemplates:common.statuses.todo",
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
      key: "changes-requested",
      name: "projectTemplates:content.marketing-assets.statuses.changesRequested",
      group: "started",
    },
    {
      key: "delivered",
      name: "projectTemplates:common.statuses.delivered",
      group: "completed",
    },
    {
      key: "declined",
      name: "projectTemplates:common.statuses.declined",
      group: "cancelled",
    },
  ],

  labels: [
    {
      key: "rush",
      name: "projectTemplates:content.marketing-assets.labels.rush",
      color: "red",
    },
    {
      key: "from-template",
      name: "projectTemplates:content.marketing-assets.labels.fromTemplate",
      color: "green",
    },
  ],

  customFields: [
    {
      key: "asset-type",
      name: "projectTemplates:content.marketing-assets.fields.assetType",
      type: "dropdown",
      options: [
        {
          key: "social-graphic",
          label:
            "projectTemplates:content.marketing-assets.options.assetType.socialGraphic",
        },
        {
          key: "web-banner",
          label:
            "projectTemplates:content.marketing-assets.options.assetType.webBanner",
        },
        {
          key: "display-ad",
          label:
            "projectTemplates:content.marketing-assets.options.assetType.displayAd",
        },
        { key: "print", label: "projectTemplates:common.options.print" },
        {
          key: "presentation",
          label:
            "projectTemplates:content.marketing-assets.options.assetType.presentation",
        },
        {
          key: "video",
          label:
            "projectTemplates:content.marketing-assets.options.assetType.video",
        },
        { key: "other", label: "projectTemplates:common.options.other" },
      ],
      required: true,
      defaultOption: "other",
    },
    {
      key: "sizes",
      name: "projectTemplates:content.marketing-assets.fields.sizes",
      type: "text",
    },
    {
      key: "needed-by",
      name: "projectTemplates:common.fields.neededBy",
      type: "date",
    },
    {
      key: "campaign",
      name: "projectTemplates:content.marketing-assets.fields.campaign",
      type: "text",
    },
  ],

  views: [
    {
      name: "projectTemplates:content.marketing-assets.views.queue",
      filters: {
        root: { key: "group", operator: "notIn", values: ["cancelled"] },
      },
      display: {
        layout: "board",
        groupBy: "status",
        orderBy: { field: "priority" },
      },
      displayProperties: { customFields: ["asset-type", "needed-by"] },
    },
    {
      name: "projectTemplates:content.marketing-assets.views.byAssetType",
      filters: {
        root: {
          key: "group",
          operator: "notIn",
          values: ["completed", "cancelled"],
        },
      },
      display: {
        layout: "list",
        groupBy: { customField: "asset-type" },
        orderBy: { field: { customField: "needed-by" }, direction: "asc" },
      },
    },
    {
      name: "projectTemplates:common.views.dueSoon",
      description:
        "projectTemplates:content.marketing-assets.views.dueSoonDescription",
      filters: {
        root: {
          op: "and",
          children: [
            { key: "dueDate", operator: "withinNext", amount: 7, unit: "days" },
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
  ],

  intakeForm: {
    title: "projectTemplates:content.marketing-assets.form.title",
    intro: "projectTemplates:content.marketing-assets.form.intro",
    descriptionField: "required",
    nameField: "required",
    emailField: "required",
    customFields: ["asset-type", "sizes", "needed-by", "campaign"],
    confirmationMessage:
      "projectTemplates:content.marketing-assets.form.confirmation",
  },

  taskTemplates: [
    {
      name: "projectTemplates:content.marketing-assets.taskTemplates.assetRequest.name",
      description:
        "projectTemplates:content.marketing-assets.taskTemplates.assetRequest.description",
      priority: "medium",
    },
  ],

  automationRules: [
    {
      name: "projectTemplates:content.marketing-assets.rules.checkBrief",
      trigger: { type: "task_created", fromIntake: true },
      actions: [
        {
          type: "add_comment",
          template:
            "projectTemplates:content.marketing-assets.rules.checkBriefComment",
        },
      ],
    },
    {
      name: "projectTemplates:content.marketing-assets.rules.rush",
      trigger: { type: "label_added", labels: ["rush"] },
      actions: [
        { type: "set_priority", priority: "urgent" },
        {
          type: "notify",
          roles: ["lead"],
          message:
            "projectTemplates:content.marketing-assets.rules.rushMessage",
        },
      ],
    },
    {
      name: "projectTemplates:content.marketing-assets.rules.changesRequested",
      trigger: { type: "status_changed", to: ["changes-requested"] },
      actions: [
        {
          type: "notify",
          roles: ["assignees"],
          message:
            "projectTemplates:content.marketing-assets.rules.changesRequestedMessage",
        },
      ],
    },
  ],

  pages: [
    {
      key: "how-to-request",
      title:
        "projectTemplates:content.marketing-assets.pages.howToRequest.title",
      logo: { kind: "icon", value: "BookOpen" },
      sections: [
        {
          heading: "projectTemplates:common.pages.whatToInclude",
          starter:
            "projectTemplates:content.marketing-assets.pages.howToRequest.whatToIncludeStarter",
        },
        {
          heading: "projectTemplates:common.pages.leadTimes",
          starter:
            "projectTemplates:content.marketing-assets.pages.howToRequest.leadTimesStarter",
        },
        {
          heading:
            "projectTemplates:content.marketing-assets.pages.howToRequest.rush",
          starter:
            "projectTemplates:content.marketing-assets.pages.howToRequest.rushStarter",
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
            "projectTemplates:content.marketing-assets.pages.brandBasics.logo",
          starter:
            "projectTemplates:content.marketing-assets.pages.brandBasics.logoStarter",
        },
        {
          heading:
            "projectTemplates:content.marketing-assets.pages.brandBasics.colours",
          starter: "-",
        },
        {
          heading:
            "projectTemplates:content.marketing-assets.pages.brandBasics.type",
          starter: "-",
        },
        {
          heading:
            "projectTemplates:content.marketing-assets.pages.brandBasics.tone",
          starter:
            "projectTemplates:content.marketing-assets.pages.brandBasics.toneStarter",
        },
        {
          heading:
            "projectTemplates:content.marketing-assets.pages.brandBasics.files",
          starter:
            "projectTemplates:content.marketing-assets.pages.brandBasics.filesStarter",
        },
      ],
    },
  ],

  sample: {
    tasks: [
      {
        key: "trade-show-banner",
        title:
          "projectTemplates:content.marketing-assets.samples.tradeShowBanner",
        description:
          "projectTemplates:content.marketing-assets.samples.tradeShowBannerDescription",
        column: "in-progress",
        priority: "high",
        assignee: "creator",
        startInDays: -2,
        dueInDays: 9,
        customFields: {
          "asset-type": "print",
          sizes:
            "projectTemplates:content.marketing-assets.samples.tradeShowBannerSizes",
        },
      },
      {
        key: "glaze-social",
        title: "projectTemplates:content.marketing-assets.samples.glazeSocial",
        column: "in-review",
        priority: "medium",
        labels: ["from-template"],
        dueInDays: 4,
        customFields: { "asset-type": "social-graphic" },
      },
      {
        key: "sales-deck",
        title: "projectTemplates:content.marketing-assets.samples.salesDeck",
        column: "todo",
        priority: "medium",
        dueInDays: 14,
        customFields: {
          "asset-type": "presentation",
          campaign:
            "projectTemplates:content.marketing-assets.samples.salesDeckCampaign",
        },
      },
      {
        key: "hero-banner",
        title: "projectTemplates:content.marketing-assets.samples.heroBanner",
        description:
          "projectTemplates:content.marketing-assets.samples.heroBannerDescription",
        column: "changes-requested",
        priority: "high",
        assignee: "creator",
        startInDays: -5,
        dueInDays: 2,
        customFields: { "asset-type": "web-banner" },
      },
      {
        key: "video-end-card",
        title: "projectTemplates:content.marketing-assets.samples.videoEndCard",
        column: "delivered",
        priority: "low",
        dueInDays: -3,
        customFields: { "asset-type": "video" },
      },
      {
        key: "open-studio-flyer",
        title:
          "projectTemplates:content.marketing-assets.samples.openStudioFlyer",
        description:
          "projectTemplates:content.marketing-assets.samples.openStudioFlyerDescription",
        column: "todo",
        priority: "urgent",
        labels: ["rush"],
        dueInDays: 3,
        customFields: { "asset-type": "print" },
      },
    ],
  },
};

export default template;
