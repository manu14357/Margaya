import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/go-to-market.md

const C = "projectTemplates:content.go-to-market";

const template: ProjectTemplate = {
  id: "go-to-market",
  version: 1,
  categories: ["marketing", "work-management"],
  icon: "Rocket",
  name: "projectTemplates:catalog.go-to-market.name",
  pitch: "projectTemplates:catalog.go-to-market.pitch",
  description: "projectTemplates:catalog.go-to-market.description",
  suggestedKey: "GTM",

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
      key: "ready",
      name: "projectTemplates:common.statuses.ready",
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
    { key: "messaging", name: `${C}.labels.messaging`, color: "purple" },
    { key: "content", name: `${C}.labels.content`, color: "teal" },
    {
      key: "sales-enablement",
      name: `${C}.labels.salesEnablement`,
      color: "yellow",
    },
    {
      key: "support-readiness",
      name: `${C}.labels.supportReadiness`,
      color: "orange",
    },
    { key: "launch-day", name: `${C}.labels.launchDay`, color: "red" },
  ],

  customFields: [
    {
      key: "phase",
      name: "projectTemplates:common.fields.phase",
      type: "dropdown",
      options: [
        { key: "pre-launch", label: `${C}.options.phase.preLaunch` },
        { key: "launch-week", label: `${C}.options.phase.launchWeek` },
        { key: "post-launch", label: `${C}.options.phase.postLaunch` },
      ],
    },
    {
      key: "go-no-go",
      name: `${C}.fields.goNoGo`,
      type: "boolean",
      defaultValue: "false",
    },
  ],

  views: [
    {
      name: `${C}.views.launchTimeline`,
      description: `${C}.views.launchTimelineDescription`,
      filters: {
        root: { key: "group", operator: "notIn", values: ["cancelled"] },
      },
      display: {
        layout: "gantt",
        groupBy: null,
        orderBy: { field: "startDate", direction: "asc" },
      },
    },
    {
      name: `${C}.views.byPhase`,
      filters: {
        root: { key: "group", operator: "notIn", values: ["cancelled"] },
      },
      display: {
        layout: "list",
        groupBy: { customField: "phase" },
        orderBy: { field: "dueDate", direction: "asc" },
      },
    },
    {
      name: `${C}.views.readiness`,
      description: `${C}.views.readinessDescription`,
      filters: {
        root: {
          key: "customField",
          field: "go-no-go",
          operator: "in",
          options: ["true"],
        },
      },
      display: {
        layout: "list",
        groupBy: "status",
        orderBy: { field: "priority", direction: "desc" },
      },
    },
  ],

  taskTemplates: [
    {
      name: `${C}.taskTemplates.launchAsset.name`,
      description: `${C}.taskTemplates.launchAsset.description`,
      priority: "medium",
    },
    {
      name: `${C}.taskTemplates.signOff.name`,
      description: `${C}.taskTemplates.signOff.description`,
      priority: "high",
    },
  ],

  automationRules: [
    {
      name: `${C}.rules.readyForCall`,
      trigger: { type: "status_changed", to: ["ready"] },
      conditions: {
        op: "and",
        conditions: [
          {
            field: "custom_field",
            fieldKey: "go-no-go",
            op: "equals",
            value: "true",
          },
        ],
      },
      actions: [
        {
          type: "notify",
          roles: ["lead"],
          message: `${C}.rules.readyMessage`,
        },
      ],
    },
    {
      name: `${C}.rules.overdueItem`,
      trigger: { type: "due_date_passed" },
      conditions: {
        op: "and",
        conditions: [
          {
            field: "custom_field",
            fieldKey: "go-no-go",
            op: "equals",
            value: "true",
          },
        ],
      },
      actions: [
        { type: "set_priority", priority: "urgent" },
        {
          type: "notify",
          roles: ["assignees"],
          message: `${C}.rules.overdueMessage`,
        },
      ],
    },
  ],

  updateReminder: { enabled: true, weekday: 5 },

  pages: [
    {
      key: "brief",
      title: `${C}.pages.brief.title`,
      logo: { kind: "icon", value: "Rocket" },
      sections: [
        {
          heading: `${C}.pages.brief.whatIsLaunching`,
          starter: `${C}.pages.brief.whatIsLaunchingStarter`,
        },
        { heading: "projectTemplates:common.pages.audience", starter: "-" },
        {
          heading: "projectTemplates:common.pages.keyMessage",
          starter: `${C}.pages.brief.keyMessageStarter`,
        },
        {
          heading: `${C}.pages.brief.launchSize`,
          starter: `${C}.pages.brief.launchSizeStarter`,
        },
        {
          heading: "projectTemplates:common.pages.timeline",
          starter: `${C}.pages.brief.timelineStarter`,
        },
        {
          heading: "projectTemplates:common.pages.successMeasures",
          starter: "-",
        },
      ],
    },
    {
      key: "go-no-go",
      title: `${C}.pages.goNoGo.title`,
      logo: { kind: "icon", value: "Flag" },
      sections: [
        { heading: `${C}.pages.goNoGo.items`, starter: "- [ ]" },
        {
          heading: "projectTemplates:common.pages.whoApproves",
          starter: `${C}.pages.goNoGo.whoApprovesStarter`,
        },
        {
          heading: `${C}.pages.goNoGo.exceptions`,
          starter: `${C}.pages.goNoGo.exceptionsStarter`,
        },
        {
          heading: `${C}.pages.goNoGo.fallback`,
          starter: `${C}.pages.goNoGo.fallbackStarter`,
        },
      ],
    },
    {
      key: "review",
      title: `${C}.pages.review.title`,
      logo: { kind: "icon", value: "Target" },
      sections: [
        {
          heading: "projectTemplates:common.pages.results",
          starter: `${C}.pages.review.resultsStarter`,
        },
        {
          heading: "projectTemplates:common.pages.whatWentWell",
          starter: "-",
        },
        {
          heading: "projectTemplates:common.pages.whatToChangeNextTime",
          starter: "-",
        },
      ],
    },
  ],

  sample: {
    tasks: [
      {
        key: "positioning",
        title: `${C}.samples.positioning`,
        description: `${C}.samples.positioningDescription`,
        column: "done",
        priority: "high",
        labels: ["messaging"],
        assignee: "creator",
        startInDays: -21,
        dueInDays: -10,
        customFields: { phase: "pre-launch", "go-no-go": "true" },
      },
      {
        key: "sales-kit",
        title: `${C}.samples.salesKit`,
        column: "in-progress",
        priority: "high",
        labels: ["sales-enablement"],
        startInDays: -7,
        dueInDays: 6,
        customFields: { phase: "pre-launch", "go-no-go": "true" },
        relations: [{ type: "finish_before", to: "go-no-go" }],
      },
      {
        key: "support",
        title: `${C}.samples.support`,
        description: `${C}.samples.supportDescription`,
        column: "todo",
        priority: "high",
        labels: ["support-readiness"],
        startInDays: 0,
        dueInDays: 10,
        customFields: { phase: "pre-launch", "go-no-go": "true" },
        relations: [{ type: "finish_before", to: "go-no-go" }],
      },
      {
        key: "announcement",
        title: `${C}.samples.announcement`,
        column: "in-review",
        priority: "medium",
        labels: ["content"],
        startInDays: -5,
        dueInDays: 4,
        customFields: { phase: "pre-launch" },
      },
      {
        key: "go-no-go",
        title: `${C}.samples.goNoGo`,
        description: `${C}.samples.goNoGoDescription`,
        column: "todo",
        priority: "urgent",
        labels: ["launch-day"],
        assignee: "creator",
        dueInDays: 12,
        isMilestone: true,
        customFields: { phase: "launch-week", "go-no-go": "true" },
      },
      {
        key: "watch-rota",
        title: `${C}.samples.watchRota`,
        column: "todo",
        priority: "medium",
        labels: ["launch-day"],
        startInDays: 11,
        dueInDays: 14,
        customFields: { phase: "launch-week" },
      },
      {
        key: "review",
        title: `${C}.samples.review`,
        column: "todo",
        priority: "medium",
        startInDays: 44,
        dueInDays: 46,
        customFields: { phase: "post-launch" },
      },
    ],
  },
};

export default template;
