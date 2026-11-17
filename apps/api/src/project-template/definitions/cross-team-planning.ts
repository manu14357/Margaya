import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/cross-team-planning.md
//
// Shared goals are modules, but the engine creates modules for every project,
// not only with sample data, so the template ships none: teams add their own
// goals, and the sample tasks name their goal in the description instead.

const template: ProjectTemplate = {
  id: "cross-team-planning",
  version: 1,
  categories: ["software-development"],
  icon: "Flag",
  name: "projectTemplates:catalog.cross-team-planning.name",
  pitch: "projectTemplates:catalog.cross-team-planning.pitch",
  description: "projectTemplates:catalog.cross-team-planning.description",
  suggestedKey: "PLAN",

  project: {
    description:
      "projectTemplates:content.cross-team-planning.projectDescription",
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
      key: "agreed",
      name: "projectTemplates:content.cross-team-planning.statuses.agreed",
      group: "unstarted",
    },
    {
      key: "in-progress",
      name: "projectTemplates:common.statuses.inProgress",
      group: "started",
    },
    {
      key: "delivered",
      name: "projectTemplates:common.statuses.delivered",
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
      key: "needs-another-team",
      name: "projectTemplates:common.labels.needsAnotherTeam",
      color: "orange",
    },
    {
      key: "at-risk",
      name: "projectTemplates:common.labels.atRisk",
      color: "red",
    },
  ],

  customFields: [
    {
      key: "owning-team",
      name: "projectTemplates:common.fields.owningTeam",
      type: "text",
    },
    {
      key: "commitment",
      name: "projectTemplates:common.fields.commitment",
      type: "dropdown",
      options: [
        {
          key: "committed",
          label: "projectTemplates:common.options.committed",
        },
        { key: "stretch", label: "projectTemplates:common.options.stretch" },
      ],
    },
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
  ],

  views: [
    {
      name: "projectTemplates:content.cross-team-planning.views.planTimeline",
      description:
        "projectTemplates:content.cross-team-planning.views.planTimelineDescription",
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
      name: "projectTemplates:common.views.byTeam",
      description:
        "projectTemplates:content.cross-team-planning.views.byTeamDescription",
      filters: {
        root: {
          key: "group",
          operator: "notIn",
          values: ["completed", "cancelled"],
        },
      },
      display: {
        layout: "list",
        groupBy: { customField: "owning-team" },
        orderBy: { field: "dueDate", direction: "asc" },
      },
    },
    {
      name: "projectTemplates:content.cross-team-planning.views.dependencies",
      description:
        "projectTemplates:content.cross-team-planning.views.dependenciesDescription",
      filters: {
        root: {
          op: "or",
          children: [
            { key: "blocked", operator: "in", values: ["true"] },
            { key: "label", operator: "in", labels: ["needs-another-team"] },
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
      name: "projectTemplates:content.cross-team-planning.views.commitments",
      description:
        "projectTemplates:content.cross-team-planning.views.commitmentsDescription",
      filters: {
        root: { key: "group", operator: "notIn", values: ["cancelled"] },
      },
      display: {
        layout: "spreadsheet",
        groupBy: { customField: "commitment" },
        orderBy: { field: "dueDate", direction: "asc" },
      },
      displayProperties: {
        dueDate: true,
        customFields: ["owning-team", "confidence"],
      },
    },
  ],

  taskTemplates: [
    {
      name: "projectTemplates:content.cross-team-planning.taskTemplates.deliverable.name",
      description:
        "projectTemplates:content.cross-team-planning.taskTemplates.deliverable.description",
      priority: "medium",
    },
  ],

  automationRules: [
    {
      name: "projectTemplates:content.cross-team-planning.rules.crossTeam",
      trigger: { type: "label_added", labels: ["needs-another-team"] },
      actions: [
        {
          type: "notify",
          roles: ["lead"],
          message:
            "projectTemplates:content.cross-team-planning.rules.crossTeamMessage",
        },
        {
          type: "add_comment",
          template:
            "projectTemplates:content.cross-team-planning.rules.crossTeamComment",
        },
      ],
    },
    {
      name: "projectTemplates:content.cross-team-planning.rules.atRisk",
      trigger: { type: "label_added", labels: ["at-risk"] },
      actions: [
        {
          type: "notify",
          roles: ["lead", "assignees"],
          message:
            "projectTemplates:content.cross-team-planning.rules.atRiskMessage",
        },
      ],
    },
    {
      name: "projectTemplates:content.cross-team-planning.rules.missedDate",
      trigger: { type: "due_date_passed" },
      actions: [
        {
          type: "notify",
          roles: ["assignees", "lead"],
          message:
            "projectTemplates:content.cross-team-planning.rules.missedDateMessage",
        },
      ],
    },
  ],

  // The plan asks for every other Friday; reminders are weekly only.
  updateReminder: { enabled: true, weekday: 5 },

  pages: [
    {
      key: "agenda",
      title: "projectTemplates:content.cross-team-planning.pages.agenda.title",
      logo: { kind: "icon", value: "Users" },
      sections: [
        {
          heading: "projectTemplates:common.pages.context",
          starter:
            "projectTemplates:content.cross-team-planning.pages.agenda.contextStarter",
        },
        {
          heading:
            "projectTemplates:content.cross-team-planning.pages.agenda.drafts",
          starter:
            "projectTemplates:content.cross-team-planning.pages.agenda.draftsStarter",
        },
        {
          heading:
            "projectTemplates:content.cross-team-planning.pages.agenda.dependencies",
          starter:
            "projectTemplates:content.cross-team-planning.pages.agenda.dependenciesStarter",
        },
        {
          heading:
            "projectTemplates:content.cross-team-planning.pages.agenda.confidence",
          starter:
            "projectTemplates:content.cross-team-planning.pages.agenda.confidenceStarter",
        },
        {
          heading:
            "projectTemplates:content.cross-team-planning.pages.agenda.commitments",
          starter: "- [ ]",
        },
      ],
    },
    {
      key: "goals",
      title: "projectTemplates:content.cross-team-planning.pages.goals.title",
      logo: { kind: "icon", value: "Target" },
      sections: [
        {
          heading: "projectTemplates:common.pages.goal",
          starter:
            "projectTemplates:content.cross-team-planning.pages.goals.goalStarter",
        },
        {
          heading: "projectTemplates:common.pages.successMeasures",
          starter:
            "projectTemplates:content.cross-team-planning.pages.goals.measureStarter",
        },
        {
          heading:
            "projectTemplates:content.cross-team-planning.pages.goals.lead",
          starter: "-",
        },
        {
          heading:
            "projectTemplates:content.cross-team-planning.pages.goals.teams",
          starter: "-",
        },
        {
          heading:
            "projectTemplates:content.cross-team-planning.pages.goals.midPeriod",
          starter:
            "projectTemplates:content.cross-team-planning.pages.goals.midPeriodStarter",
        },
      ],
    },
  ],

  sample: {
    tasks: [
      {
        key: "api-estimates",
        title:
          "projectTemplates:content.cross-team-planning.samples.apiEstimates",
        description:
          "projectTemplates:content.cross-team-planning.samples.apiEstimatesDescription",
        column: "agreed",
        priority: "high",
        assignee: "creator",
        startInDays: 7,
        dueInDays: 35,
        customFields: {
          "owning-team":
            "projectTemplates:content.cross-team-planning.samples.teams.api",
          commitment: "committed",
          confidence: "high",
        },
        relations: [{ type: "blocks", to: "mobile-estimates" }],
      },
      {
        key: "mobile-estimates",
        title:
          "projectTemplates:content.cross-team-planning.samples.mobileEstimates",
        description:
          "projectTemplates:content.cross-team-planning.samples.mobileEstimatesDescription",
        column: "agreed",
        priority: "high",
        labels: ["needs-another-team"],
        startInDays: 36,
        dueInDays: 63,
        customFields: {
          "owning-team":
            "projectTemplates:content.cross-team-planning.samples.teams.mobile",
          commitment: "committed",
          confidence: "medium",
        },
      },
      {
        key: "reorder",
        title: "projectTemplates:content.cross-team-planning.samples.reorder",
        description:
          "projectTemplates:content.cross-team-planning.samples.reorderDescription",
        column: "proposed",
        priority: "medium",
        startInDays: 49,
        dueInDays: 77,
        customFields: {
          "owning-team":
            "projectTemplates:content.cross-team-planning.samples.teams.web",
          commitment: "stretch",
          confidence: "low",
        },
      },
      {
        key: "refund-tickets",
        title:
          "projectTemplates:content.cross-team-planning.samples.refundTickets",
        description:
          "projectTemplates:content.cross-team-planning.samples.refundTicketsDescription",
        column: "in-progress",
        priority: "medium",
        startInDays: -14,
        dueInDays: 56,
        customFields: {
          "owning-team":
            "projectTemplates:content.cross-team-planning.samples.teams.supportTools",
          commitment: "committed",
          confidence: "medium",
        },
      },
      {
        key: "refund-status",
        title:
          "projectTemplates:content.cross-team-planning.samples.refundStatus",
        description:
          "projectTemplates:content.cross-team-planning.samples.refundStatusDescription",
        column: "in-progress",
        priority: "medium",
        labels: ["at-risk"],
        startInDays: -7,
        dueInDays: 28,
        customFields: {
          "owning-team":
            "projectTemplates:content.cross-team-planning.samples.teams.web",
          commitment: "committed",
          confidence: "low",
        },
      },
    ],
  },
};

export default template;
