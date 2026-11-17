import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/content-calendar.md

const T = "projectTemplates:content.content-calendar" as const;

const template: ProjectTemplate = {
  id: "content-calendar",
  version: 1,
  categories: ["marketing", "work-management"],
  icon: "Calendar",
  name: "projectTemplates:catalog.content-calendar.name",
  pitch: "projectTemplates:catalog.content-calendar.pitch",
  description: "projectTemplates:catalog.content-calendar.description",
  suggestedKey: "CAL",

  project: {
    description: `${T}.projectDescription`,
    features: {
      cycles: false,
      modules: false,
      views: true,
      pages: true,
      whiteboards: false,
      intake: false,
      estimates: false,
      timeTracking: false,
      ai: false,
      updates: false,
    },
    lead: "creator",
  },

  columns: [
    {
      key: "ideas",
      name: "projectTemplates:common.statuses.ideas",
      group: "backlog",
    },
    { key: "assigned", name: `${T}.statuses.assigned`, group: "unstarted" },
    {
      key: "drafting",
      name: "projectTemplates:common.statuses.drafting",
      group: "started",
    },
    { key: "editing", name: `${T}.statuses.editing`, group: "started" },
    {
      key: "scheduled",
      name: "projectTemplates:common.statuses.scheduled",
      group: "started",
    },
    {
      key: "published",
      name: "projectTemplates:common.statuses.published",
      group: "completed",
    },
    {
      key: "dropped",
      name: "projectTemplates:common.statuses.dropped",
      group: "cancelled",
    },
  ],

  labels: [
    { key: "article", name: `${T}.labels.article`, color: "teal" },
    {
      key: "social",
      name: "projectTemplates:common.labels.social",
      color: "purple",
    },
    { key: "video", name: `${T}.labels.video`, color: "orange" },
    {
      key: "newsletter",
      name: "projectTemplates:common.labels.newsletter",
      color: "yellow",
    },
  ],

  // The due date is the publish date, so every dated piece shows on the calendar.
  customFields: [
    {
      key: "pillar",
      name: `${T}.fields.pillar`,
      type: "dropdown",
      options: [
        { key: "how-to", label: `${T}.options.pillar.howTo` },
        { key: "product", label: `${T}.options.pillar.product` },
        {
          key: "customer-stories",
          label: `${T}.options.pillar.customerStories`,
        },
        {
          key: "behind-the-scenes",
          label: `${T}.options.pillar.behindTheScenes`,
        },
      ],
    },
    { key: "keyword", name: `${T}.fields.keyword`, type: "text" },
    { key: "live-link", name: `${T}.fields.liveLink`, type: "text" },
  ],

  views: [
    {
      name: "projectTemplates:common.views.calendar",
      filters: {
        root: { key: "group", operator: "notIn", values: ["cancelled"] },
      },
      display: { layout: "calendar", groupBy: null },
    },
    {
      name: "projectTemplates:common.views.pipeline",
      filters: {
        root: { key: "group", operator: "notIn", values: ["cancelled"] },
      },
      display: { layout: "board", groupBy: "status" },
    },
    {
      name: `${T}.views.ideasBank`,
      filters: {
        root: { key: "status", operator: "in", columns: ["ideas"] },
      },
      display: {
        layout: "list",
        groupBy: null,
        orderBy: { field: "createdAt", direction: "desc" },
      },
    },
    {
      name: `${T}.views.byPillar`,
      filters: {
        root: { key: "group", operator: "notIn", values: ["cancelled"] },
      },
      display: {
        layout: "list",
        groupBy: { customField: "pillar" },
        orderBy: { field: "dueDate", direction: "asc" },
      },
    },
  ],

  taskTemplates: [
    {
      name: `${T}.taskTemplates.article.name`,
      description: `${T}.taskTemplates.article.description`,
      priority: "medium",
      labels: ["article"],
      subtasks: [
        `${T}.subtasks.outline`,
        `${T}.subtasks.draft`,
        `${T}.subtasks.edit`,
        `${T}.subtasks.images`,
        `${T}.subtasks.finalCheck`,
        `${T}.subtasks.schedule`,
      ],
    },
    {
      name: `${T}.taskTemplates.socialPost.name`,
      description: `${T}.taskTemplates.socialPost.description`,
      priority: "low",
      labels: ["social"],
    },
  ],

  automationRules: [
    {
      name: `${T}.rules.askForDate`,
      trigger: { type: "status_changed", to: ["assigned"] },
      conditions: {
        op: "and",
        conditions: [{ field: "due_date", op: "not_set" }],
      },
      actions: [
        { type: "add_comment", template: `${T}.rules.askForDateComment` },
      ],
    },
  ],

  pages: [
    {
      key: "content-strategy",
      title: `${T}.pages.strategy.title`,
      logo: { kind: "icon", value: "Target" },
      sections: [
        {
          heading: "projectTemplates:common.pages.audience",
          starter: `${T}.pages.strategy.audienceStarter`,
        },
        {
          heading: `${T}.pages.strategy.pillars`,
          starter: `${T}.pages.strategy.pillarsStarter`,
        },
        { heading: "projectTemplates:common.pages.channels", starter: "-" },
        {
          heading: `${T}.pages.strategy.rhythm`,
          starter: `${T}.pages.strategy.rhythmStarter`,
        },
      ],
    },
    {
      key: "style-guide",
      title: `${T}.pages.styleGuide.title`,
      logo: { kind: "icon", value: "BookOpen" },
      sections: [
        {
          heading: `${T}.pages.styleGuide.voice`,
          starter: `${T}.pages.styleGuide.voiceStarter`,
        },
        { heading: `${T}.pages.styleGuide.spelling`, starter: "-" },
        {
          heading: `${T}.pages.styleGuide.headlines`,
          starter: `${T}.pages.styleGuide.headlinesStarter`,
        },
      ],
    },
  ],

  sample: {
    tasks: [
      {
        key: "seeds-indoors",
        title: `${T}.samples.seedsIndoors`,
        description: `${T}.samples.seedsIndoorsDescription`,
        column: "published",
        priority: "medium",
        labels: ["article"],
        dueInDays: -6,
        customFields: {
          pillar: "how-to",
          keyword: `${T}.samples.seedsIndoorsKeyword`,
          "live-link": `${T}.samples.seedsIndoorsLink`,
        },
      },
      {
        key: "packing-team",
        title: `${T}.samples.packingTeam`,
        description: `${T}.samples.packingTeamDescription`,
        column: "editing",
        priority: "medium",
        labels: ["video"],
        startInDays: -5,
        dueInDays: 4,
        customFields: { pillar: "behind-the-scenes" },
      },
      {
        key: "shade-plants",
        title: `${T}.samples.shadePlants`,
        column: "drafting",
        priority: "medium",
        labels: ["article"],
        assignee: "creator",
        startInDays: -2,
        dueInDays: 9,
        customFields: {
          pillar: "how-to",
          keyword: `${T}.samples.shadePlantsKeyword`,
        },
      },
      {
        key: "newsletter",
        title: `${T}.samples.newsletter`,
        description: `${T}.samples.newsletterDescription`,
        column: "assigned",
        priority: "high",
        labels: ["newsletter"],
        assignee: "creator",
        dueInDays: 14,
        customFields: { pillar: "product" },
      },
      {
        key: "garden-tours",
        title: `${T}.samples.gardenTours`,
        column: "ideas",
        priority: "low",
        labels: ["social"],
        customFields: { pillar: "customer-stories" },
      },
      {
        key: "watering-can",
        title: `${T}.samples.wateringCan`,
        column: "scheduled",
        priority: "medium",
        labels: ["social"],
        dueInDays: 2,
        customFields: { pillar: "product" },
      },
    ],
  },
};

export default template;
