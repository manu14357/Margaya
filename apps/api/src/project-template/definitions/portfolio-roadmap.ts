import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/portfolio-roadmap.md

const c = "projectTemplates:content.portfolio-roadmap" as const;

const template: ProjectTemplate = {
  id: "portfolio-roadmap",
  version: 1,
  categories: ["product-management", "software-development"],
  icon: "Layers",
  name: "projectTemplates:catalog.portfolio-roadmap.name",
  pitch: "projectTemplates:catalog.portfolio-roadmap.pitch",
  description: "projectTemplates:catalog.portfolio-roadmap.description",
  suggestedKey: "PORT",

  project: {
    description: `${c}.projectDescription`,
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
      key: "proposed",
      name: "projectTemplates:common.statuses.proposed",
      group: "backlog",
    },
    {
      key: "approved",
      name: "projectTemplates:common.statuses.approved",
      group: "unstarted",
    },
    { key: "active", name: `${c}.statuses.active`, group: "started" },
    { key: "complete", name: `${c}.statuses.complete`, group: "completed" },
    { key: "stopped", name: `${c}.statuses.stopped`, group: "cancelled" },
  ],

  labels: [
    {
      key: "at-risk",
      name: "projectTemplates:common.labels.atRisk",
      color: "orange",
    },
    { key: "off-track", name: `${c}.labels.offTrack`, color: "red" },
    { key: "on-hold", name: `${c}.labels.onHold`, color: "gray" },
  ],

  customFields: [
    {
      key: "investment-area",
      name: `${c}.fields.investmentArea`,
      type: "dropdown",
      options: [
        { key: "grow", label: `${c}.options.investmentArea.grow` },
        { key: "sustain", label: `${c}.options.investmentArea.sustain` },
        { key: "explore", label: `${c}.options.investmentArea.explore` },
      ],
    },
    {
      key: "size",
      name: `${c}.fields.size`,
      type: "dropdown",
      options: [
        { key: "s", label: `${c}.options.size.s` },
        { key: "m", label: `${c}.options.size.m` },
        { key: "l", label: `${c}.options.size.l` },
        { key: "xl", label: `${c}.options.size.xl` },
      ],
    },
    {
      key: "owning-team",
      name: "projectTemplates:common.fields.owningTeam",
      type: "text",
    },
    {
      key: "success-measure",
      name: "projectTemplates:common.fields.successMeasure",
      type: "text",
    },
  ],

  modules: [
    {
      key: "grow-mid-size",
      name: `${c}.modules.growMidSize`,
      description: `${c}.modules.growMidSizeDescription`,
      status: "in-progress",
    },
    {
      key: "reliable-foundations",
      name: `${c}.modules.reliableFoundations`,
      description: `${c}.modules.reliableFoundationsDescription`,
      status: "in-progress",
    },
  ],

  views: [
    {
      name: `${c}.views.portfolioTimeline`,
      description: `${c}.views.portfolioTimelineDescription`,
      filters: {
        root: { key: "group", operator: "notIn", values: ["cancelled"] },
      },
      display: {
        layout: "gantt",
        groupBy: "module",
        orderBy: { field: "startDate", direction: "asc" },
      },
    },
    {
      name: `${c}.views.investmentMix`,
      description: `${c}.views.investmentMixDescription`,
      filters: {
        root: {
          key: "status",
          operator: "in",
          columns: ["approved", "active"],
        },
      },
      display: {
        layout: "list",
        groupBy: { customField: "investment-area" },
        subGroupBy: { customField: "size" },
      },
      displayProperties: { customFields: ["owning-team", "success-measure"] },
    },
    {
      name: `${c}.views.needsAttention`,
      filters: {
        root: {
          key: "label",
          operator: "in",
          labels: ["at-risk", "off-track", "on-hold"],
        },
      },
      display: {
        layout: "list",
        groupBy: null,
        orderBy: { field: "dueDate", direction: "asc" },
      },
    },
    {
      name: `${c}.views.proposals`,
      filters: {
        root: { key: "status", operator: "in", columns: ["proposed"] },
      },
      display: {
        layout: "list",
        groupBy: null,
        orderBy: { field: "createdAt", direction: "asc" },
      },
    },
  ],

  taskTemplates: [
    {
      name: `${c}.taskTemplates.initiativeProposal.name`,
      description: `${c}.taskTemplates.initiativeProposal.description`,
      column: "proposed",
      priority: "medium",
    },
  ],

  automationRules: [
    {
      name: `${c}.rules.risksReachLead`,
      trigger: { type: "label_added", labels: ["at-risk", "off-track"] },
      actions: [
        {
          type: "notify",
          roles: ["lead", "assignees"],
          message: `${c}.rules.risksMessage`,
        },
      ],
    },
    {
      name: `${c}.rules.approvedMeansPlanned`,
      trigger: { type: "status_changed", to: ["approved"] },
      conditions: {
        op: "and",
        conditions: [{ field: "due_date", op: "not_set" }],
      },
      actions: [
        { type: "add_comment", template: `${c}.rules.addDatesComment` },
      ],
    },
  ],

  pages: [
    {
      key: "review-agenda",
      title: `${c}.pages.reviewAgenda.title`,
      logo: { kind: "icon", value: "List" },
      sections: [
        { heading: `${c}.pages.reviewAgenda.healthChanges`, starter: "-" },
        {
          heading: `${c}.pages.reviewAgenda.needsAttention`,
          starter: `${c}.pages.reviewAgenda.needsAttentionStarter`,
        },
        { heading: `${c}.pages.reviewAgenda.proposals`, starter: "-" },
        {
          heading: `${c}.pages.reviewAgenda.mix`,
          starter: `${c}.pages.reviewAgenda.mixStarter`,
        },
        {
          heading: "projectTemplates:common.pages.decisions",
          starter: `${c}.pages.reviewAgenda.decisionsStarter`,
        },
      ],
    },
    {
      key: "investment-criteria",
      title: `${c}.pages.criteria.title`,
      logo: { kind: "icon", value: "PieChart" },
      sections: [
        {
          heading: `${c}.pages.criteria.areas`,
          starter: `${c}.pages.criteria.areasStarter`,
        },
        {
          heading: `${c}.pages.criteria.targetMix`,
          starter: `${c}.pages.criteria.targetMixStarter`,
        },
        {
          heading: `${c}.pages.criteria.judging`,
          starter: `${c}.pages.criteria.judgingStarter`,
        },
        {
          heading: `${c}.pages.criteria.stopping`,
          starter: `${c}.pages.criteria.stoppingStarter`,
        },
      ],
    },
  ],

  sample: {
    tasks: [
      {
        key: "self-serve-upgrades",
        title: `${c}.samples.selfServeUpgrades`,
        column: "active",
        priority: "high",
        assignee: "creator",
        startInDays: -30,
        dueInDays: 45,
        module: "grow-mid-size",
        customFields: {
          "investment-area": "grow",
          size: "m",
          "owning-team": `${c}.samples.billingTeam`,
          "success-measure": `${c}.samples.selfServeMeasure`,
        },
      },
      {
        key: "reporting-move",
        title: `${c}.samples.reportingMove`,
        description: `${c}.samples.reportingMoveDescription`,
        column: "active",
        priority: "medium",
        labels: ["at-risk"],
        startInDays: -60,
        dueInDays: 90,
        module: "reliable-foundations",
        customFields: {
          "investment-area": "sustain",
          size: "l",
          "owning-team": `${c}.samples.dataTeam`,
        },
      },
      {
        key: "marketplace-pilot",
        title: `${c}.samples.marketplacePilot`,
        description: `${c}.samples.marketplacePilotDescription`,
        column: "proposed",
        priority: "medium",
        module: "grow-mid-size",
        customFields: {
          "investment-area": "explore",
          size: "m",
          "owning-team": `${c}.samples.partnerships`,
        },
      },
      {
        key: "cloud-spend",
        title: `${c}.samples.cloudSpend`,
        column: "approved",
        priority: "medium",
        startInDays: 14,
        dueInDays: 100,
        module: "reliable-foundations",
        customFields: {
          "investment-area": "sustain",
          size: "m",
          "owning-team": `${c}.samples.platformTeam`,
          "success-measure": `${c}.samples.cloudSpendMeasure`,
        },
        relations: [{ type: "related", to: "reporting-move" }],
      },
      {
        key: "accessibility-review",
        title: `${c}.samples.accessibilityReview`,
        column: "complete",
        priority: "medium",
        startInDays: -75,
        dueInDays: -20,
        module: "reliable-foundations",
        customFields: {
          "investment-area": "sustain",
          size: "s",
          "owning-team": `${c}.samples.designSystems`,
        },
      },
      {
        key: "voice-notes",
        title: `${c}.samples.voiceNotes`,
        description: `${c}.samples.voiceNotesDescription`,
        column: "stopped",
        priority: "low",
        module: "grow-mid-size",
        customFields: { "investment-area": "explore", size: "m" },
      },
    ],
  },
};

export default template;
