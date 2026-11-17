import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/campaign-management.md

const C = "projectTemplates:content.campaign-management";

const template: ProjectTemplate = {
  id: "campaign-management",
  version: 1,
  categories: ["marketing", "work-management"],
  icon: "Target",
  name: "projectTemplates:catalog.campaign-management.name",
  pitch: "projectTemplates:catalog.campaign-management.pitch",
  description: "projectTemplates:catalog.campaign-management.description",
  suggestedKey: "CAMP",

  project: {
    description: `${C}.projectDescription`,
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
    {
      key: "scheduled",
      name: "projectTemplates:common.statuses.scheduled",
      group: "unstarted",
    },
    {
      key: "in-production",
      name: `${C}.statuses.inProduction`,
      group: "started",
    },
    {
      key: "in-review",
      name: "projectTemplates:common.statuses.inReview",
      group: "started",
    },
    { key: "live", name: `${C}.statuses.live`, group: "started" },
    {
      key: "done",
      name: "projectTemplates:common.statuses.done",
      group: "completed",
    },
    {
      key: "cancelled",
      name: "projectTemplates:common.statuses.cancelled",
      group: "cancelled",
    },
  ],

  labels: [
    { key: "email", name: `${C}.labels.email`, color: "teal" },
    {
      key: "social",
      name: "projectTemplates:common.labels.social",
      color: "purple",
    },
    { key: "paid", name: `${C}.labels.paid`, color: "yellow" },
    { key: "web", name: `${C}.labels.web`, color: "green" },
    { key: "pr", name: `${C}.labels.pr`, color: "orange" },
  ],

  customFields: [
    { key: "budget", name: `${C}.fields.budget`, type: "number" },
    {
      key: "target",
      name: "projectTemplates:common.fields.target",
      type: "text",
    },
    {
      key: "result",
      name: "projectTemplates:common.fields.result",
      type: "text",
    },
  ],

  views: [
    {
      name: `${C}.views.campaignCalendar`,
      filters: {
        root: { key: "group", operator: "notIn", values: ["cancelled"] },
      },
      display: { layout: "calendar", groupBy: null },
    },
    {
      name: `${C}.views.byCampaign`,
      filters: {
        root: { key: "group", operator: "notIn", values: ["cancelled"] },
      },
      display: {
        layout: "list",
        groupBy: "module",
        orderBy: { field: "dueDate", direction: "asc" },
      },
    },
    {
      name: `${C}.views.liveNow`,
      description: `${C}.views.liveNowDescription`,
      filters: {
        root: { key: "status", operator: "in", columns: ["live"] },
      },
      display: {
        layout: "list",
        groupBy: "label",
        orderBy: { field: "dueDate", direction: "asc" },
      },
    },
    {
      name: `${C}.views.budgetSheet`,
      display: {
        layout: "spreadsheet",
        groupBy: null,
        orderBy: { field: "module", direction: "asc" },
      },
      displayProperties: {
        modules: true,
        labels: true,
        customFields: ["budget", "target", "result"],
      },
    },
  ],

  taskTemplates: [
    {
      name: `${C}.taskTemplates.channelPiece.name`,
      description: `${C}.taskTemplates.channelPiece.description`,
      priority: "medium",
    },
    {
      name: `${C}.taskTemplates.wrapUp.name`,
      description: `${C}.taskTemplates.wrapUp.description`,
      priority: "medium",
    },
  ],

  automationRules: [
    {
      name: `${C}.rules.wentLive`,
      trigger: { type: "status_changed", to: ["live"] },
      actions: [{ type: "add_comment", template: `${C}.rules.liveComment` }],
    },
  ],

  pages: [
    {
      key: "brief",
      title: `${C}.pages.brief.title`,
      logo: { kind: "icon", value: "Target" },
      sections: [
        {
          heading: "projectTemplates:common.pages.goal",
          starter: `${C}.pages.brief.goalStarter`,
        },
        { heading: "projectTemplates:common.pages.audience", starter: "" },
        {
          heading: "projectTemplates:common.pages.keyMessage",
          starter: `${C}.pages.brief.keyMessageStarter`,
        },
        { heading: "projectTemplates:common.pages.channels", starter: "-" },
        { heading: "projectTemplates:common.pages.budget", starter: "" },
        {
          heading: "projectTemplates:common.pages.timeline",
          starter: `${C}.pages.brief.timelineStarter`,
        },
        {
          heading: "projectTemplates:common.pages.successMeasures",
          starter: "-",
        },
        { heading: "projectTemplates:common.pages.whoApproves", starter: "-" },
      ],
    },
    {
      key: "results",
      title: `${C}.pages.results.title`,
      logo: { kind: "icon", value: "PieChart" },
      sections: [
        {
          heading: "projectTemplates:common.pages.results",
          starter: `${C}.pages.results.resultsStarter`,
        },
        { heading: `${C}.pages.results.spend`, starter: "" },
        { heading: `${C}.pages.results.lessons`, starter: "-" },
        {
          heading: "projectTemplates:common.pages.nextSteps",
          starter: "- [ ]",
        },
      ],
    },
  ],

  sample: {
    tasks: [
      {
        key: "brief",
        title: `${C}.samples.brief`,
        description: `${C}.samples.briefDescription`,
        column: "done",
        priority: "high",
        assignee: "creator",
        startInDays: -14,
        dueInDays: -9,
        customFields: { target: `${C}.samples.briefTarget` },
      },
      {
        key: "landing-page",
        title: `${C}.samples.landingPage`,
        column: "in-production",
        priority: "high",
        labels: ["web"],
        startInDays: -3,
        dueInDays: 4,
        relations: [{ type: "finish_before", to: "search-ads" }],
      },
      {
        key: "search-ads",
        title: `${C}.samples.searchAds`,
        description: `${C}.samples.searchAdsDescription`,
        column: "in-review",
        priority: "medium",
        labels: ["paid"],
        dueInDays: 6,
        customFields: { budget: "1500" },
      },
      {
        key: "social-series",
        title: `${C}.samples.socialSeries`,
        column: "scheduled",
        priority: "medium",
        labels: ["social"],
        startInDays: 7,
        dueInDays: 13,
      },
      {
        key: "reminder-email",
        title: `${C}.samples.reminderEmail`,
        description: `${C}.samples.reminderEmailDescription`,
        column: "live",
        priority: "high",
        labels: ["email"],
        assignee: "creator",
        startInDays: -2,
        dueInDays: 5,
        customFields: { target: `${C}.samples.reminderEmailTarget` },
      },
      {
        key: "partner-newsletter",
        title: `${C}.samples.partnerNewsletter`,
        column: "ideas",
        priority: "low",
        labels: ["pr"],
      },
    ],
  },
};

export default template;
