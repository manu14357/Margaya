import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/process-control.md

const template: ProjectTemplate = {
  id: "process-control",
  version: 1,
  categories: ["operations", "work-management"],
  icon: "Cog",
  name: "projectTemplates:catalog.process-control.name",
  pitch: "projectTemplates:catalog.process-control.pitch",
  description: "projectTemplates:catalog.process-control.description",
  suggestedKey: "PDCA",

  project: {
    description: "projectTemplates:content.process-control.projectDescription",
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
    {
      key: "plan",
      name: "projectTemplates:content.process-control.statuses.plan",
      group: "unstarted",
    },
    {
      key: "do",
      name: "projectTemplates:content.process-control.statuses.do",
      group: "started",
    },
    {
      key: "check",
      name: "projectTemplates:content.process-control.statuses.check",
      group: "started",
    },
    {
      key: "act",
      name: "projectTemplates:content.process-control.statuses.act",
      group: "started",
    },
    {
      key: "standardized",
      name: "projectTemplates:content.process-control.statuses.standardized",
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
      key: "quality",
      name: "projectTemplates:content.process-control.labels.quality",
      color: "teal",
    },
    {
      key: "safety",
      name: "projectTemplates:common.labels.safety",
      color: "red",
    },
    {
      key: "cost",
      name: "projectTemplates:content.process-control.labels.cost",
      color: "yellow",
    },
    {
      key: "speed",
      name: "projectTemplates:content.process-control.labels.speed",
      color: "purple",
    },
    {
      key: "control-check",
      name: "projectTemplates:content.process-control.labels.controlCheck",
      color: "dark-gray",
    },
  ],

  customFields: [
    {
      key: "measure",
      name: "projectTemplates:content.process-control.fields.measure",
      type: "text",
    },
    {
      key: "baseline",
      name: "projectTemplates:content.process-control.fields.baseline",
      type: "number",
    },
    {
      key: "target",
      name: "projectTemplates:common.fields.target",
      type: "number",
    },
    {
      key: "result",
      name: "projectTemplates:common.fields.result",
      type: "number",
    },
  ],

  views: [
    {
      name: "projectTemplates:content.process-control.views.improvementCycle",
      description:
        "projectTemplates:content.process-control.views.improvementCycleDescription",
      filters: {
        root: { key: "label", operator: "notIn", labels: ["control-check"] },
      },
      display: { layout: "board", groupBy: "status" },
    },
    {
      name: "projectTemplates:common.views.results",
      description:
        "projectTemplates:content.process-control.views.resultsDescription",
      filters: {
        root: {
          key: "status",
          operator: "in",
          columns: ["check", "act", "standardized"],
        },
      },
      display: {
        layout: "spreadsheet",
        groupBy: null,
        orderBy: { field: "updatedAt", direction: "desc" },
      },
      displayProperties: {
        customFields: ["measure", "baseline", "target", "result"],
      },
    },
    {
      name: "projectTemplates:content.process-control.views.controlChecks",
      description:
        "projectTemplates:content.process-control.views.controlChecksDescription",
      filters: {
        root: {
          op: "and",
          children: [
            { key: "label", operator: "in", labels: ["control-check"] },
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
  ],

  taskTemplates: [
    {
      name: "projectTemplates:content.process-control.taskTemplates.improvement.name",
      description:
        "projectTemplates:content.process-control.taskTemplates.improvement.description",
      priority: "medium",
    },
    {
      name: "projectTemplates:content.process-control.taskTemplates.controlCheck.name",
      description:
        "projectTemplates:content.process-control.taskTemplates.controlCheck.description",
      priority: "medium",
      labels: ["control-check"],
    },
  ],

  automationRules: [
    {
      name: "projectTemplates:content.process-control.rules.checkDue",
      trigger: { type: "status_changed", to: ["check"] },
      actions: [
        { type: "set_due_date", offsetDays: 14 },
        {
          type: "add_comment",
          template:
            "projectTemplates:content.process-control.rules.checkComment",
        },
      ],
    },
    {
      name: "projectTemplates:content.process-control.rules.standardize",
      trigger: { type: "status_changed", to: ["standardized"] },
      actions: [
        {
          type: "create_subtask",
          title:
            "projectTemplates:content.process-control.rules.standardizeSubtask",
        },
      ],
    },
  ],

  pages: [
    {
      key: "standard-work",
      title:
        "projectTemplates:content.process-control.pages.standardWork.title",
      logo: { kind: "icon", value: "ScrollText" },
      sections: [
        {
          heading: "projectTemplates:common.pages.purpose",
          starter:
            "projectTemplates:content.process-control.pages.standardWork.purposeStarter",
        },
        { heading: "projectTemplates:common.pages.steps", starter: "1." },
        {
          heading:
            "projectTemplates:content.process-control.pages.standardWork.owner",
          starter:
            "projectTemplates:content.process-control.pages.standardWork.ownerStarter",
        },
        {
          heading:
            "projectTemplates:content.process-control.pages.standardWork.checking",
          starter:
            "projectTemplates:content.process-control.pages.standardWork.checkingStarter",
        },
        {
          heading:
            "projectTemplates:content.process-control.pages.standardWork.reaction",
          starter:
            "projectTemplates:content.process-control.pages.standardWork.reactionStarter",
        },
      ],
    },
    {
      key: "improvement-log",
      title:
        "projectTemplates:content.process-control.pages.improvementLog.title",
      logo: { kind: "icon", value: "List" },
      sections: [
        {
          heading:
            "projectTemplates:content.process-control.pages.improvementLog.changesTried",
          starter: "-",
        },
        { heading: "projectTemplates:common.pages.results", starter: "-" },
        { heading: "projectTemplates:common.pages.decisions", starter: "-" },
      ],
    },
  ],

  sample: {
    tasks: [
      {
        key: "mislabelled",
        title: "projectTemplates:content.process-control.samples.mislabelled",
        description:
          "projectTemplates:content.process-control.samples.mislabelledDescription",
        column: "check",
        priority: "high",
        labels: ["quality"],
        assignee: "creator",
        startInDays: -14,
        dueInDays: 3,
        customFields: {
          measure:
            "projectTemplates:content.process-control.samples.mislabelledMeasure",
          baseline: "5",
          target: "1",
          result: "1.5",
        },
        relations: [{ type: "related", to: "spot-check" }],
      },
      {
        key: "line-setup",
        title: "projectTemplates:content.process-control.samples.lineSetup",
        column: "do",
        priority: "medium",
        labels: ["speed"],
        startInDays: -4,
        dueInDays: 10,
        customFields: {
          measure:
            "projectTemplates:content.process-control.samples.lineSetupMeasure",
          baseline: "25",
          target: "15",
        },
      },
      {
        key: "walkway",
        title: "projectTemplates:content.process-control.samples.walkway",
        column: "standardized",
        priority: "high",
        labels: ["safety"],
      },
      {
        key: "offcuts",
        title: "projectTemplates:content.process-control.samples.offcuts",
        column: "plan",
        priority: "low",
        labels: ["cost"],
      },
      {
        key: "two-bin",
        title: "projectTemplates:content.process-control.samples.twoBin",
        column: "ideas",
        priority: "low",
        labels: ["cost"],
      },
      {
        key: "spot-check",
        title: "projectTemplates:content.process-control.samples.spotCheck",
        description:
          "projectTemplates:content.process-control.samples.spotCheckDescription",
        column: "plan",
        priority: "medium",
        labels: ["control-check"],
        dueInDays: 2,
        recurrence: { frequency: "weekly", trigger: "schedule" },
      },
    ],
  },
};

export default template;
