import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/prioritization.md

const template: ProjectTemplate = {
  id: "prioritization",
  version: 1,
  categories: ["product-management", "software-development"],
  icon: "Target",
  name: "projectTemplates:catalog.prioritization.name",
  pitch: "projectTemplates:catalog.prioritization.pitch",
  description: "projectTemplates:catalog.prioritization.description",
  suggestedKey: "PRI",

  project: {
    description: "projectTemplates:content.prioritization.projectDescription",
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
      key: "candidates",
      name: "projectTemplates:content.prioritization.statuses.candidates",
      group: "backlog",
    },
    {
      key: "scored",
      name: "projectTemplates:content.prioritization.statuses.scored",
      group: "unstarted",
    },
    {
      key: "in-delivery",
      name: "projectTemplates:content.prioritization.statuses.inDelivery",
      group: "started",
    },
    {
      key: "done",
      name: "projectTemplates:common.statuses.done",
      group: "completed",
    },
    {
      key: "not-now",
      name: "projectTemplates:content.prioritization.statuses.notNow",
      group: "cancelled",
    },
  ],

  labels: [
    {
      key: "needs-data",
      name: "projectTemplates:content.prioritization.labels.needsData",
      color: "yellow",
    },
  ],

  // Plain number fields: the engine has no allowed-values or formula fields
  // yet, so the scales live in the scoring guide and Score is typed by hand.
  customFields: [
    {
      key: "reach",
      name: "projectTemplates:common.fields.reach",
      type: "number",
    },
    {
      key: "impact",
      name: "projectTemplates:common.fields.impact",
      type: "number",
    },
    {
      key: "confidence",
      name: "projectTemplates:common.fields.confidence",
      type: "number",
    },
    {
      key: "effort",
      name: "projectTemplates:content.prioritization.fields.effort",
      type: "number",
    },
    {
      key: "score",
      name: "projectTemplates:common.fields.score",
      type: "number",
    },
  ],

  views: [
    {
      name: "projectTemplates:content.prioritization.views.ranking",
      description:
        "projectTemplates:content.prioritization.views.rankingDescription",
      filters: {
        root: { key: "status", operator: "in", columns: ["scored"] },
      },
      display: {
        layout: "spreadsheet",
        groupBy: null,
        orderBy: { field: { customField: "score" }, direction: "desc" },
      },
      displayProperties: {
        customFields: ["reach", "impact", "confidence", "effort", "score"],
      },
    },
    {
      name: "projectTemplates:content.prioritization.views.needsScoring",
      description:
        "projectTemplates:content.prioritization.views.needsScoringDescription",
      filters: {
        root: { key: "status", operator: "in", columns: ["candidates"] },
      },
      display: {
        layout: "list",
        groupBy: null,
        orderBy: { field: "createdAt", direction: "asc" },
      },
    },
    {
      name: "projectTemplates:content.prioritization.views.shakyNumbers",
      description:
        "projectTemplates:content.prioritization.views.shakyNumbersDescription",
      filters: {
        root: {
          op: "or",
          children: [
            { key: "label", operator: "in", labels: ["needs-data"] },
            {
              key: "customField",
              field: "confidence",
              operator: "in",
              options: ["50"],
            },
          ],
        },
      },
      display: {
        layout: "list",
        groupBy: null,
        orderBy: { field: { customField: "score" }, direction: "desc" },
      },
    },
  ],

  taskTemplates: [
    {
      name: "projectTemplates:content.prioritization.taskTemplates.candidate.name",
      description:
        "projectTemplates:content.prioritization.taskTemplates.candidate.description",
      priority: "no-priority",
    },
  ],

  pages: [
    {
      key: "scoring-guide",
      title: "projectTemplates:content.prioritization.pages.guide.title",
      logo: { kind: "icon", value: "BookOpen" },
      sections: [
        {
          heading: "projectTemplates:common.fields.reach",
          starter:
            "projectTemplates:content.prioritization.pages.guide.reachStarter",
        },
        {
          heading: "projectTemplates:common.fields.impact",
          starter:
            "projectTemplates:content.prioritization.pages.guide.impactStarter",
        },
        {
          heading: "projectTemplates:common.fields.confidence",
          starter:
            "projectTemplates:content.prioritization.pages.guide.confidenceStarter",
        },
        {
          heading: "projectTemplates:content.prioritization.fields.effort",
          starter:
            "projectTemplates:content.prioritization.pages.guide.effortStarter",
        },
        {
          heading:
            "projectTemplates:content.prioritization.pages.guide.formula",
          starter:
            "projectTemplates:content.prioritization.pages.guide.formulaStarter",
        },
        {
          heading:
            "projectTemplates:content.prioritization.pages.guide.fixedScales",
          starter:
            "projectTemplates:content.prioritization.pages.guide.fixedScalesStarter",
        },
        {
          heading:
            "projectTemplates:content.prioritization.pages.guide.usingScore",
          starter:
            "projectTemplates:content.prioritization.pages.guide.usingScoreStarter",
        },
        {
          heading:
            "projectTemplates:content.prioritization.pages.guide.lighter",
          starter:
            "projectTemplates:content.prioritization.pages.guide.lighterStarter",
        },
      ],
    },
  ],

  sample: {
    tasks: [
      {
        key: "remember-filter",
        title: "projectTemplates:content.prioritization.samples.rememberFilter",
        column: "scored",
        customFields: {
          reach: "4000",
          impact: "1",
          confidence: "80",
          effort: "0.5",
          score: "6400",
        },
      },
      {
        key: "single-sign-on",
        title: "projectTemplates:content.prioritization.samples.singleSignOn",
        column: "scored",
        customFields: {
          reach: "600",
          impact: "2",
          confidence: "80",
          effort: "3",
          score: "320",
        },
      },
      {
        key: "offline-mode",
        title: "projectTemplates:content.prioritization.samples.offlineMode",
        description:
          "projectTemplates:content.prioritization.samples.offlineModeDescription",
        column: "scored",
        labels: ["needs-data"],
        customFields: {
          reach: "1500",
          impact: "2",
          confidence: "50",
          effort: "6",
          score: "250",
        },
      },
      {
        key: "bulk-archive",
        title: "projectTemplates:content.prioritization.samples.bulkArchive",
        column: "scored",
        customFields: {
          reach: "900",
          impact: "0.5",
          confidence: "100",
          effort: "0.5",
          score: "900",
        },
      },
      {
        key: "recurring-invoices",
        title:
          "projectTemplates:content.prioritization.samples.recurringInvoices",
        description:
          "projectTemplates:content.prioritization.samples.recurringInvoicesDescription",
        column: "candidates",
      },
      {
        key: "two-step-approval",
        title:
          "projectTemplates:content.prioritization.samples.twoStepApproval",
        column: "in-delivery",
        priority: "high",
        assignee: "creator",
        startInDays: -2,
        customFields: {
          reach: "1200",
          impact: "2",
          confidence: "80",
          effort: "2",
          score: "960",
        },
      },
    ],
  },
};

export default template;
