import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/product-roadmap.md

const template: ProjectTemplate = {
  id: "product-roadmap",
  version: 1,
  categories: ["product-management", "software-development"],
  icon: "Rocket",
  name: "projectTemplates:catalog.product-roadmap.name",
  pitch: "projectTemplates:catalog.product-roadmap.pitch",
  description: "projectTemplates:catalog.product-roadmap.description",
  suggestedKey: "ROAD",

  project: {
    description: "projectTemplates:content.product-roadmap.projectDescription",
    features: {
      cycles: false,
      modules: true,
      views: true,
      pages: true,
      whiteboards: false,
      intake: false,
      estimates: false,
      timeTracking: false,
      ai: false,
      updates: true,
    },
    lead: "creator",
  },

  columns: [
    {
      key: "later",
      name: "projectTemplates:content.product-roadmap.statuses.later",
      group: "backlog",
    },
    {
      key: "next",
      name: "projectTemplates:content.product-roadmap.statuses.next",
      group: "unstarted",
    },
    {
      key: "now",
      name: "projectTemplates:content.product-roadmap.statuses.now",
      group: "started",
    },
    {
      key: "released",
      name: "projectTemplates:content.product-roadmap.statuses.released",
      group: "completed",
    },
    {
      key: "dropped",
      name: "projectTemplates:common.statuses.dropped",
      group: "cancelled",
    },
  ],

  labels: [
    {
      key: "customer-commitment",
      name: "projectTemplates:content.product-roadmap.labels.customerCommitment",
      color: "red",
    },
    {
      key: "needs-design",
      name: "projectTemplates:common.labels.needsDesign",
      color: "purple",
    },
  ],

  customFields: [
    {
      key: "confidence",
      name: "projectTemplates:common.fields.confidence",
      type: "dropdown",
      options: [
        { key: "high", label: "projectTemplates:common.options.high" },
        { key: "medium", label: "projectTemplates:common.options.medium" },
        { key: "low", label: "projectTemplates:common.options.low" },
      ],
    },
    {
      key: "success-measure",
      name: "projectTemplates:common.fields.successMeasure",
      type: "text",
    },
  ],

  modules: [
    {
      key: "faster-onboarding",
      name: "projectTemplates:content.product-roadmap.modules.fasterOnboarding",
      description:
        "projectTemplates:content.product-roadmap.modules.fasterOnboardingDescription",
      status: "in-progress",
    },
    {
      key: "trusted-reporting",
      name: "projectTemplates:content.product-roadmap.modules.trustedReporting",
      description:
        "projectTemplates:content.product-roadmap.modules.trustedReportingDescription",
      status: "in-progress",
    },
  ],

  views: [
    {
      name: "projectTemplates:content.product-roadmap.views.roadmap",
      description:
        "projectTemplates:content.product-roadmap.views.roadmapDescription",
      filters: {
        root: { key: "group", operator: "notIn", values: ["cancelled"] },
      },
      display: { layout: "board", groupBy: "status", subGroupBy: "module" },
      displayProperties: { customFields: ["confidence"] },
    },
    {
      name: "projectTemplates:content.product-roadmap.views.byTheme",
      filters: {
        root: { key: "group", operator: "notIn", values: ["cancelled"] },
      },
      display: {
        layout: "list",
        groupBy: "module",
        orderBy: { field: "status", direction: "asc" },
      },
      displayProperties: { customFields: ["confidence", "success-measure"] },
    },
    {
      name: "projectTemplates:common.views.timeline",
      description:
        "projectTemplates:content.product-roadmap.views.timelineDescription",
      filters: {
        root: { key: "status", operator: "in", columns: ["now", "next"] },
      },
      display: {
        layout: "gantt",
        groupBy: "module",
        orderBy: { field: "startDate", direction: "asc" },
      },
    },
    {
      name: "projectTemplates:content.product-roadmap.views.released",
      filters: {
        root: { key: "status", operator: "in", columns: ["released"] },
      },
      display: {
        layout: "list",
        groupBy: null,
        orderBy: { field: "completedAt", direction: "desc" },
      },
    },
  ],

  taskTemplates: [
    {
      name: "projectTemplates:content.product-roadmap.taskTemplates.roadmapItem.name",
      description:
        "projectTemplates:content.product-roadmap.taskTemplates.roadmapItem.description",
      priority: "medium",
    },
  ],

  automationRules: [
    {
      name: "projectTemplates:content.product-roadmap.rules.datesForNow",
      trigger: { type: "status_changed", to: ["now"] },
      conditions: {
        op: "and",
        conditions: [{ field: "due_date", op: "not_set" }],
      },
      actions: [
        {
          type: "add_comment",
          template:
            "projectTemplates:content.product-roadmap.rules.datesForNowComment",
        },
      ],
    },
    {
      name: "projectTemplates:content.product-roadmap.rules.protectPromises",
      trigger: { type: "label_added", labels: ["customer-commitment"] },
      actions: [
        {
          type: "notify",
          roles: ["lead"],
          message:
            "projectTemplates:content.product-roadmap.rules.protectPromisesMessage",
        },
      ],
    },
  ],

  updateReminder: { enabled: true, weekday: 5 },

  pages: [
    {
      key: "narrative",
      title: "projectTemplates:content.product-roadmap.pages.narrative.title",
      logo: { kind: "icon", value: "Rocket" },
      sections: [
        {
          heading:
            "projectTemplates:content.product-roadmap.pages.narrative.vision",
          starter:
            "projectTemplates:content.product-roadmap.pages.narrative.visionStarter",
        },
        {
          heading:
            "projectTemplates:content.product-roadmap.pages.narrative.themes",
          starter:
            "projectTemplates:content.product-roadmap.pages.narrative.themesStarter",
        },
        {
          heading:
            "projectTemplates:content.product-roadmap.pages.narrative.howToRead",
          starter:
            "projectTemplates:content.product-roadmap.pages.narrative.howToReadStarter",
        },
        {
          heading:
            "projectTemplates:content.product-roadmap.pages.narrative.notDoing",
          starter: "-",
        },
        {
          heading:
            "projectTemplates:content.product-roadmap.pages.narrative.requests",
          starter:
            "projectTemplates:content.product-roadmap.pages.narrative.requestsStarter",
        },
      ],
    },
  ],

  sample: {
    tasks: [
      {
        key: "spreadsheet-import",
        title:
          "projectTemplates:content.product-roadmap.samples.spreadsheetImport",
        description:
          "projectTemplates:content.product-roadmap.samples.spreadsheetImportDescription",
        column: "now",
        priority: "high",
        assignee: "creator",
        module: "faster-onboarding",
        startInDays: -7,
        dueInDays: 21,
        customFields: {
          confidence: "high",
          "success-measure":
            "projectTemplates:content.product-roadmap.samples.spreadsheetImportMeasure",
        },
      },
      {
        key: "template-gallery",
        title:
          "projectTemplates:content.product-roadmap.samples.templateGallery",
        column: "next",
        priority: "medium",
        module: "faster-onboarding",
        customFields: { confidence: "medium" },
      },
      {
        key: "report-emails",
        title: "projectTemplates:content.product-roadmap.samples.reportEmails",
        description:
          "projectTemplates:content.product-roadmap.samples.reportEmailsDescription",
        column: "next",
        priority: "medium",
        labels: ["customer-commitment"],
        module: "trusted-reporting",
        startInDays: 28,
        dueInDays: 70,
        customFields: { confidence: "medium" },
      },
      {
        key: "chart-explanations",
        title:
          "projectTemplates:content.product-roadmap.samples.chartExplanations",
        column: "later",
        priority: "low",
        labels: ["needs-design"],
        module: "trusted-reporting",
        customFields: { confidence: "low" },
      },
      {
        key: "audit-trail",
        title: "projectTemplates:content.product-roadmap.samples.auditTrail",
        column: "released",
        priority: "high",
        module: "trusted-reporting",
        startInDays: -45,
        dueInDays: -10,
        customFields: { confidence: "high" },
      },
    ],
  },
};

export default template;
