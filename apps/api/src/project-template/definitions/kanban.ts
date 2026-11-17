import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/kanban.md

const template: ProjectTemplate = {
  id: "kanban",
  version: 1,
  categories: ["software-development", "customer-service"],
  featured: true,
  icon: "FolderKanban",
  name: "projectTemplates:catalog.kanban.name",
  pitch: "projectTemplates:catalog.kanban.pitch",
  description: "projectTemplates:catalog.kanban.description",
  suggestedKey: "KAN",

  project: {
    description: "projectTemplates:content.kanban.projectDescription",
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
      key: "backlog",
      name: "projectTemplates:common.statuses.backlog",
      group: "backlog",
    },
    {
      key: "ready",
      name: "projectTemplates:common.statuses.ready",
      group: "unstarted",
    },
    {
      key: "in-progress",
      name: "projectTemplates:common.statuses.inProgress",
      group: "started",
    },
    {
      key: "review",
      name: "projectTemplates:common.statuses.inReview",
      group: "started",
    },
    {
      key: "done",
      name: "projectTemplates:common.statuses.done",
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
      key: "expedite",
      name: "projectTemplates:content.kanban.labels.expedite",
      color: "red",
    },
    {
      key: "fixed-date",
      name: "projectTemplates:content.kanban.labels.fixedDate",
      color: "yellow",
    },
    {
      key: "waiting",
      name: "projectTemplates:common.labels.waiting",
      color: "orange",
    },
  ],

  views: [
    {
      name: "projectTemplates:content.kanban.views.aging",
      description: "projectTemplates:content.kanban.views.agingDescription",
      filters: {
        root: { key: "group", operator: "in", values: ["started"] },
      },
      display: {
        layout: "list",
        groupBy: "status",
        orderBy: { field: "updatedAt", direction: "asc" },
      },
    },
    {
      name: "projectTemplates:content.kanban.views.blocked",
      filters: {
        root: {
          op: "or",
          children: [
            { key: "blocked", operator: "in", values: ["true"] },
            { key: "label", operator: "in", labels: ["waiting"] },
          ],
        },
      },
      display: {
        layout: "list",
        groupBy: null,
        orderBy: { field: "updatedAt", direction: "asc" },
      },
    },
    {
      name: "projectTemplates:content.kanban.views.expedite",
      filters: {
        root: { key: "label", operator: "in", labels: ["expedite"] },
      },
      display: { layout: "board", groupBy: "status" },
    },
    {
      name: "projectTemplates:content.kanban.views.recentlyFinished",
      filters: {
        root: {
          key: "completedAt",
          operator: "withinLast",
          amount: 14,
          unit: "days",
        },
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
      name: "projectTemplates:content.kanban.taskTemplates.workItem.name",
      description:
        "projectTemplates:content.kanban.taskTemplates.workItem.description",
      priority: "no-priority",
    },
    {
      name: "projectTemplates:content.kanban.taskTemplates.expedite.name",
      description:
        "projectTemplates:content.kanban.taskTemplates.expedite.description",
      priority: "urgent",
      labels: ["expedite"],
    },
  ],

  automationRules: [
    {
      name: "projectTemplates:content.kanban.rules.expediteAttention",
      trigger: { type: "label_added", labels: ["expedite"] },
      actions: [
        { type: "set_priority", priority: "urgent" },
        {
          type: "notify",
          roles: ["lead"],
          message: "projectTemplates:content.kanban.rules.expediteMessage",
        },
      ],
    },
    {
      name: "projectTemplates:content.kanban.rules.overdueFixedDate",
      trigger: { type: "due_date_passed" },
      conditions: {
        op: "and",
        conditions: [
          { field: "labels", op: "contains", labels: ["fixed-date"] },
        ],
      },
      actions: [
        {
          type: "notify",
          roles: ["assignees", "lead"],
          message: "projectTemplates:content.kanban.rules.overdueMessage",
        },
      ],
    },
  ],

  scheduledAutomations: { flowAlerts: { enabled: true } },

  pages: [
    {
      key: "policies",
      title: "projectTemplates:content.kanban.pages.policies.title",
      logo: { kind: "icon", value: "ScrollText" },
      sections: [
        {
          heading: "projectTemplates:content.kanban.pages.policies.ready",
          starter:
            "projectTemplates:content.kanban.pages.policies.readyStarter",
        },
        {
          heading: "projectTemplates:content.kanban.pages.policies.done",
          starter: "projectTemplates:content.kanban.pages.policies.doneStarter",
        },
        {
          heading: "projectTemplates:content.kanban.pages.policies.limits",
          starter:
            "projectTemplates:content.kanban.pages.policies.limitsStarter",
        },
        {
          heading: "projectTemplates:content.kanban.pages.policies.classes",
          starter:
            "projectTemplates:content.kanban.pages.policies.classesStarter",
        },
        {
          heading: "projectTemplates:content.kanban.pages.policies.finish",
          starter:
            "projectTemplates:content.kanban.pages.policies.finishStarter",
        },
      ],
    },
    {
      key: "flow-review",
      title: "projectTemplates:content.kanban.pages.flowReview.title",
      logo: { kind: "icon", value: "List" },
      sections: [
        {
          heading: "projectTemplates:content.kanban.pages.flowReview.aged",
          starter: "-",
        },
        {
          heading: "projectTemplates:content.kanban.pages.flowReview.blocked",
          starter: "-",
        },
        {
          heading: "projectTemplates:content.kanban.pages.flowReview.change",
          starter: "",
        },
      ],
    },
  ],

  sample: {
    tasks: [
      {
        key: "tls",
        title: "projectTemplates:content.kanban.samples.tls",
        description: "projectTemplates:content.kanban.samples.tlsDescription",
        column: "ready",
        priority: "high",
        labels: ["fixed-date"],
        assignee: "creator",
        dueInDays: 5,
        recurrence: { frequency: "yearly", trigger: "completion" },
      },
      {
        key: "pagination",
        title: "projectTemplates:content.kanban.samples.pagination",
        column: "in-progress",
        priority: "medium",
        startInDays: -3,
      },
      {
        key: "empty-state",
        title: "projectTemplates:content.kanban.samples.emptyState",
        column: "review",
        priority: "low",
      },
      {
        key: "nightly-export",
        title: "projectTemplates:content.kanban.samples.nightlyExport",
        description:
          "projectTemplates:content.kanban.samples.nightlyExportDescription",
        column: "in-progress",
        priority: "urgent",
        labels: ["expedite"],
        assignee: "creator",
        dueInDays: 0,
        subtasks: [
          "projectTemplates:content.kanban.samples.findCause",
          "projectTemplates:content.kanban.samples.rerunExport",
        ],
      },
      {
        key: "image-library",
        title: "projectTemplates:content.kanban.samples.imageLibrary",
        column: "backlog",
        priority: "low",
      },
      {
        key: "vendor-key",
        title: "projectTemplates:content.kanban.samples.vendorKey",
        column: "in-progress",
        priority: "medium",
        labels: ["waiting"],
        relations: [{ type: "blocks", to: "shipping-launch" }],
      },
      {
        key: "shipping-launch",
        title: "projectTemplates:content.kanban.samples.shippingLaunch",
        column: "backlog",
        priority: "medium",
      },
    ],
  },
};

export default template;
