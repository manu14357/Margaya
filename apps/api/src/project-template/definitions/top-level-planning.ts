import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/top-level-planning.md

const C = "projectTemplates:content.top-level-planning";

const template: ProjectTemplate = {
  id: "top-level-planning",
  version: 1,
  categories: ["software-development"],
  icon: "Flag",
  name: "projectTemplates:catalog.top-level-planning.name",
  pitch: "projectTemplates:catalog.top-level-planning.pitch",
  description: "projectTemplates:catalog.top-level-planning.description",
  suggestedKey: "PRG",

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
      key: "scheduled",
      name: "projectTemplates:common.statuses.scheduled",
      group: "unstarted",
    },
    {
      key: "in-progress",
      name: "projectTemplates:common.statuses.inProgress",
      group: "started",
    },
    {
      key: "done",
      name: "projectTemplates:common.statuses.done",
      group: "completed",
    },
    {
      key: "dropped",
      name: "projectTemplates:common.statuses.dropped",
      group: "cancelled",
    },
  ],

  labels: [
    { key: "risk", name: "projectTemplates:common.labels.risk", color: "red" },
    {
      key: "decision-needed",
      name: `${C}.labels.decisionNeeded`,
      color: "purple",
    },
    { key: "dependency", name: `${C}.labels.dependency`, color: "orange" },
  ],

  customFields: [
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
      key: "owning-team",
      name: "projectTemplates:common.fields.owningTeam",
      type: "text",
    },
  ],

  // Initiatives. Created with every project (the engine has no sample-only
  // modules); leads and dates are left for the team to set.
  modules: [
    {
      key: "data-move",
      name: `${C}.modules.dataMove`,
      description: `${C}.modules.dataMoveDescription`,
      status: "in-progress",
    },
    {
      key: "new-login",
      name: `${C}.modules.newLogin`,
      description: `${C}.modules.newLoginDescription`,
      status: "planned",
    },
    {
      key: "retire-old-api",
      name: `${C}.modules.retireOldApi`,
      description: `${C}.modules.retireOldApiDescription`,
      status: "backlog",
    },
  ],

  views: [
    {
      name: "projectTemplates:common.views.timeline",
      description: `${C}.views.timelineDescription`,
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
      name: `${C}.views.byInitiative`,
      filters: {
        root: {
          key: "group",
          operator: "notIn",
          values: ["completed", "cancelled"],
        },
      },
      display: { layout: "list", groupBy: "module", subGroupBy: "status" },
    },
    {
      name: "projectTemplates:common.views.risksAndDecisions",
      filters: {
        root: {
          op: "and",
          children: [
            {
              key: "label",
              operator: "in",
              labels: ["risk", "decision-needed"],
            },
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
      name: `${C}.views.blocked`,
      filters: {
        root: { key: "blocked", operator: "in", values: ["true"] },
      },
      display: {
        layout: "list",
        groupBy: null,
        orderBy: { field: "dueDate", direction: "asc" },
      },
    },
  ],

  taskTemplates: [
    {
      name: `${C}.taskTemplates.milestone.name`,
      description: `${C}.taskTemplates.milestone.description`,
      priority: "high",
    },
    {
      name: `${C}.taskTemplates.deliverable.name`,
      description: `${C}.taskTemplates.deliverable.description`,
      priority: "medium",
    },
  ],

  automationRules: [
    {
      name: `${C}.rules.decisionsDontWait`,
      trigger: { type: "label_added", labels: ["decision-needed"] },
      actions: [
        {
          type: "notify",
          roles: ["lead"],
          message: `${C}.rules.decisionMessage`,
        },
      ],
    },
    {
      name: `${C}.rules.missedDates`,
      trigger: { type: "due_date_passed" },
      actions: [
        {
          type: "notify",
          roles: ["assignees", "lead"],
          message: `${C}.rules.missedDateMessage`,
        },
      ],
    },
    {
      name: `${C}.rules.risksGetOwner`,
      trigger: { type: "label_added", labels: ["risk"] },
      conditions: {
        op: "and",
        conditions: [{ field: "assignee", op: "empty" }],
      },
      actions: [
        { type: "add_comment", template: `${C}.rules.riskComment` },
        { type: "notify", roles: ["lead"], message: `${C}.rules.riskMessage` },
      ],
    },
  ],

  updateReminder: { enabled: true, weekday: 5 },

  pages: [
    {
      key: "program-brief",
      title: `${C}.pages.brief.title`,
      logo: { kind: "icon", value: "Target" },
      sections: [
        {
          heading: `${C}.pages.brief.why`,
          starter: `${C}.pages.brief.whyStarter`,
        },
        {
          heading: "projectTemplates:common.pages.goal",
          starter: `${C}.pages.brief.goalStarter`,
        },
        {
          heading: "projectTemplates:common.pages.scope",
          starter: `${C}.pages.brief.scopeStarter`,
        },
        { heading: `${C}.pages.brief.initiatives`, starter: "-" },
        {
          heading: "projectTemplates:common.pages.timeline",
          starter: `${C}.pages.brief.timelineStarter`,
        },
        { heading: `${C}.pages.brief.risks`, starter: "-" },
        {
          heading: "projectTemplates:common.pages.decisions",
          starter: `${C}.pages.brief.decisionsStarter`,
        },
      ],
    },
    {
      key: "update-rhythm",
      title: `${C}.pages.rhythm.title`,
      logo: { kind: "icon", value: "Calendar" },
      sections: [
        {
          heading: `${C}.pages.rhythm.who`,
          starter: `${C}.pages.rhythm.whoStarter`,
        },
        {
          heading: `${C}.pages.rhythm.health`,
          starter: `${C}.pages.rhythm.healthStarter`,
        },
        {
          heading: "projectTemplates:common.pages.whenToEscalate",
          starter: `${C}.pages.rhythm.escalateStarter`,
        },
      ],
    },
  ],

  sample: {
    tasks: [
      {
        key: "data-copied",
        title: `${C}.samples.dataCopied`,
        description: `${C}.samples.dataCopiedDescription`,
        column: "scheduled",
        priority: "high",
        module: "data-move",
        dueInDays: 42,
        isMilestone: true,
        customFields: { commitment: "committed" },
      },
      {
        key: "dual-write",
        title: `${C}.samples.dualWrite`,
        column: "in-progress",
        priority: "high",
        module: "data-move",
        startInDays: -7,
        dueInDays: 21,
        customFields: {
          commitment: "committed",
          "owning-team": `${C}.samples.platformTeam`,
        },
        relations: [{ type: "blocks", to: "data-copied" }],
      },
      {
        key: "load-test",
        title: `${C}.samples.loadTest`,
        description: `${C}.samples.loadTestDescription`,
        column: "in-progress",
        priority: "high",
        labels: ["risk"],
        module: "data-move",
        startInDays: -2,
        dueInDays: 35,
        relations: [{ type: "related", to: "data-copied" }],
      },
      {
        key: "sign-in",
        title: `${C}.samples.signIn`,
        column: "scheduled",
        priority: "medium",
        module: "new-login",
        startInDays: 14,
        dueInDays: 56,
        customFields: {
          commitment: "committed",
          "owning-team": `${C}.samples.identityTeam`,
        },
      },
      {
        key: "token-policy",
        title: `${C}.samples.tokenPolicy`,
        description: `${C}.samples.tokenPolicyDescription`,
        column: "in-progress",
        priority: "medium",
        labels: ["decision-needed"],
        assignee: "creator",
        module: "new-login",
        startInDays: -3,
        dueInDays: 7,
        relations: [{ type: "blocks", to: "sign-in" }],
      },
      {
        key: "partners",
        title: `${C}.samples.partners`,
        column: "proposed",
        priority: "medium",
        labels: ["dependency"],
        module: "retire-old-api",
        startInDays: 60,
        dueInDays: 85,
        customFields: { commitment: "stretch" },
      },
    ],
  },
};

export default template;
