import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/project-management.md

const C = "projectTemplates:content.project-management";

const template: ProjectTemplate = {
  id: "project-management",
  version: 1,
  categories: [
    "work-management",
    "marketing",
    "design",
    "customer-service",
    "personal",
  ],
  icon: "Briefcase",
  name: "projectTemplates:catalog.project-management.name",
  pitch: "projectTemplates:catalog.project-management.pitch",
  description: "projectTemplates:catalog.project-management.description",
  suggestedKey: "PM",

  project: {
    description: `${C}.projectDescription`,
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
      updates: true,
    },
    lead: "creator",
  },

  columns: [
    {
      key: "backlog",
      name: "projectTemplates:common.statuses.backlog",
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
      key: "in-review",
      name: "projectTemplates:common.statuses.inReview",
      group: "started",
    },
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
    { key: "milestone", name: `${C}.labels.milestone`, color: "green" },
    { key: "risk", name: "projectTemplates:common.labels.risk", color: "red" },
    {
      key: "decision",
      name: "projectTemplates:common.labels.decision",
      color: "purple",
    },
  ],

  customFields: [
    {
      key: "phase",
      name: "projectTemplates:common.fields.phase",
      type: "dropdown",
      options: [
        { key: "initiate", label: `${C}.options.phase.initiate` },
        { key: "plan", label: `${C}.options.phase.plan` },
        { key: "deliver", label: `${C}.options.phase.deliver` },
        { key: "close", label: `${C}.options.phase.close` },
      ],
    },
    {
      key: "sign-off",
      name: `${C}.fields.signOff`,
      type: "boolean",
      defaultValue: "false",
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
        groupBy: { customField: "phase" },
        orderBy: { field: "startDate", direction: "asc" },
      },
    },
    {
      name: "projectTemplates:common.views.myWork",
      filters: {
        root: {
          op: "and",
          children: [
            { key: "assignee", operator: "in", values: ["me"] },
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
        groupBy: "status",
        orderBy: { field: "dueDate", direction: "asc" },
      },
    },
    {
      name: `${C}.views.nextTwoWeeks`,
      filters: {
        root: {
          op: "and",
          children: [
            {
              key: "dueDate",
              operator: "withinNext",
              amount: 14,
              unit: "days",
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
      name: "projectTemplates:common.views.risksAndDecisions",
      filters: {
        root: { key: "label", operator: "in", labels: ["risk", "decision"] },
      },
      display: {
        layout: "list",
        groupBy: "label",
        orderBy: { field: "priority", direction: "desc" },
      },
    },
  ],

  taskTemplates: [
    {
      name: `${C}.taskTemplates.milestone.name`,
      description: `${C}.taskTemplates.milestone.description`,
      priority: "high",
      labels: ["milestone"],
    },
    {
      name: `${C}.taskTemplates.risk.name`,
      description: `${C}.taskTemplates.risk.description`,
      priority: "medium",
      labels: ["risk"],
    },
    {
      name: `${C}.taskTemplates.decision.name`,
      description: `${C}.taskTemplates.decision.description`,
      priority: "medium",
      labels: ["decision"],
    },
  ],

  automationRules: [
    {
      name: `${C}.rules.riskRaised`,
      trigger: { type: "label_added", labels: ["risk"] },
      actions: [
        { type: "set_priority", priority: "high" },
        { type: "notify", roles: ["lead"], message: `${C}.rules.riskMessage` },
      ],
    },
    {
      name: `${C}.rules.milestoneReached`,
      trigger: { type: "status_changed", to: ["done"] },
      conditions: {
        op: "and",
        conditions: [
          { field: "labels", op: "contains", labels: ["milestone"] },
        ],
      },
      actions: [
        { type: "add_comment", template: `${C}.rules.milestoneComment` },
        {
          type: "notify",
          roles: ["lead"],
          message: `${C}.rules.milestoneMessage`,
        },
      ],
    },
  ],

  updateReminder: { enabled: true, weekday: 5 },

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
        {
          heading: "projectTemplates:common.pages.scope",
          starter: `${C}.pages.brief.scopeStarter`,
        },
        {
          heading: "projectTemplates:common.pages.successMeasures",
          starter: "-",
        },
        {
          heading: `${C}.pages.brief.milestones`,
          starter: `${C}.pages.brief.milestonesStarter`,
        },
        {
          heading: "projectTemplates:common.pages.roles",
          starter: `${C}.pages.brief.rolesStarter`,
        },
        { heading: `${C}.pages.brief.risks`, starter: "-" },
      ],
    },
    {
      key: "closeout",
      title: `${C}.pages.closeout.title`,
      logo: { kind: "icon", value: "Flag" },
      sections: [
        { heading: `${C}.pages.closeout.delivered`, starter: "-" },
        {
          heading: "projectTemplates:common.pages.whatWentWell",
          starter: "-",
        },
        {
          heading: "projectTemplates:common.pages.whatToChangeNextTime",
          starter: "-",
        },
        {
          heading: `${C}.pages.closeout.handover`,
          starter: `${C}.pages.closeout.handoverStarter`,
        },
      ],
    },
  ],

  sample: {
    tasks: [
      {
        key: "brief",
        title: `${C}.samples.brief`,
        column: "done",
        priority: "high",
        assignee: "creator",
        startInDays: -14,
        dueInDays: -10,
        customFields: { phase: "initiate" },
      },
      {
        key: "approvers",
        title: `${C}.samples.approvers`,
        description: `${C}.samples.approversDescription`,
        column: "done",
        priority: "medium",
        labels: ["decision"],
        startInDays: -10,
        dueInDays: -7,
        customFields: { phase: "initiate" },
      },
      {
        key: "milestone-plan",
        title: `${C}.samples.milestonePlan`,
        column: "in-progress",
        priority: "high",
        assignee: "creator",
        startInDays: -5,
        dueInDays: 3,
        customFields: { phase: "plan" },
        relations: [{ type: "finish_before", to: "kickoff" }],
      },
      {
        key: "kickoff",
        title: `${C}.samples.kickoff`,
        column: "scheduled",
        priority: "medium",
        labels: ["milestone"],
        dueInDays: 7,
        isMilestone: true,
        customFields: { phase: "plan" },
      },
      {
        key: "supplier",
        title: `${C}.samples.supplier`,
        description: `${C}.samples.supplierDescription`,
        column: "scheduled",
        priority: "high",
        labels: ["risk"],
        startInDays: 7,
        dueInDays: 21,
        customFields: { phase: "deliver" },
        relations: [{ type: "related", to: "pilot" }],
      },
      {
        key: "pilot",
        title: `${C}.samples.pilot`,
        description: `${C}.samples.pilotDescription`,
        column: "backlog",
        priority: "high",
        labels: ["milestone"],
        dueInDays: 42,
        isMilestone: true,
        customFields: { phase: "deliver", "sign-off": "true" },
        relations: [{ type: "finish_before", to: "lessons" }],
      },
      {
        key: "lessons",
        title: `${C}.samples.lessons`,
        column: "backlog",
        priority: "low",
        startInDays: 49,
        dueInDays: 52,
        customFields: { phase: "close" },
      },
    ],
  },
};

export default template;
