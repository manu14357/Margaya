import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/sample-playground.md

const template: ProjectTemplate = {
  id: "sample-playground",
  version: 1,
  categories: ["product-management", "software-development"],
  icon: "Flag",
  name: "projectTemplates:catalog.sample-playground.name",
  pitch: "projectTemplates:catalog.sample-playground.pitch",
  description: "projectTemplates:catalog.sample-playground.description",
  suggestedKey: "TOUR",

  project: {
    description:
      "projectTemplates:content.sample-playground.projectDescription",
    features: {
      cycles: true,
      modules: true,
      views: true,
      pages: true,
      whiteboards: true,
      intake: false,
      estimates: true,
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
      key: "done",
      name: "projectTemplates:common.statuses.done",
      group: "completed",
    },
  ],

  labels: [
    {
      key: "tour",
      name: "projectTemplates:content.sample-playground.labels.tour",
      color: "green",
    },
    {
      key: "try-it",
      name: "projectTemplates:content.sample-playground.labels.tryIt",
      color: "purple",
    },
    {
      key: "going-further",
      name: "projectTemplates:content.sample-playground.labels.goingFurther",
      color: "dark-gray",
    },
  ],

  customFields: [
    {
      key: "tour-stop",
      name: "projectTemplates:content.sample-playground.fields.tourStop",
      type: "number",
    },
  ],

  estimate: {
    name: "projectTemplates:content.sample-playground.estimate.name",
    type: "points",
    values: ["1", "2", "3", "5"],
  },

  modules: [
    {
      key: "basics",
      name: "projectTemplates:content.sample-playground.modules.basics",
      description:
        "projectTemplates:content.sample-playground.modules.basicsDescription",
      status: "in-progress",
    },
  ],

  views: [
    {
      name: "projectTemplates:content.sample-playground.views.tourInOrder",
      description:
        "projectTemplates:content.sample-playground.views.tourInOrderDescription",
      filters: { root: { key: "label", operator: "in", labels: ["tour"] } },
      display: {
        layout: "list",
        groupBy: null,
        orderBy: { field: { customField: "tour-stop" }, direction: "asc" },
      },
    },
    {
      name: "projectTemplates:content.sample-playground.views.spreadsheet",
      description:
        "projectTemplates:content.sample-playground.views.spreadsheetDescription",
      filters: { root: null },
      display: {
        layout: "spreadsheet",
        groupBy: null,
        orderBy: { field: { customField: "tour-stop" }, direction: "asc" },
      },
      displayProperties: {
        estimate: true,
        cycle: true,
        modules: true,
        customFields: ["tour-stop"],
      },
    },
    {
      name: "projectTemplates:content.sample-playground.views.thisWeek",
      description:
        "projectTemplates:content.sample-playground.views.thisWeekDescription",
      filters: {
        root: { key: "dueDate", operator: "in", values: ["thisWeek"] },
      },
      display: { layout: "calendar", groupBy: null },
    },
  ],

  taskTemplates: [
    {
      name: "projectTemplates:content.sample-playground.taskTemplates.practice.name",
      titlePattern:
        "projectTemplates:content.sample-playground.taskTemplates.practice.titlePattern",
      description:
        "projectTemplates:content.sample-playground.taskTemplates.practice.description",
      priority: "low",
      subtasks: [
        "projectTemplates:content.sample-playground.taskTemplates.practice.changePriority",
        "projectTemplates:content.sample-playground.taskTemplates.practice.assignMe",
      ],
    },
  ],

  automationRules: [
    {
      name: "projectTemplates:content.sample-playground.rules.nextStop",
      trigger: { type: "status_changed", to: ["done"] },
      conditions: {
        op: "and",
        conditions: [{ field: "labels", op: "contains", labels: ["tour"] }],
      },
      actions: [
        {
          type: "add_comment",
          template:
            "projectTemplates:content.sample-playground.rules.nextStopComment",
        },
      ],
    },
  ],

  pages: [
    {
      key: "welcome",
      title: "projectTemplates:content.sample-playground.pages.welcome.title",
      logo: { kind: "icon", value: "BookOpen" },
      sections: [
        {
          heading:
            "projectTemplates:content.sample-playground.pages.welcome.whatFor",
          starter:
            "projectTemplates:content.sample-playground.pages.welcome.whatForStarter",
        },
        {
          heading:
            "projectTemplates:content.sample-playground.pages.welcome.layout",
          starter:
            "projectTemplates:content.sample-playground.pages.welcome.layoutStarter",
        },
        {
          heading:
            "projectTemplates:content.sample-playground.pages.welcome.stops",
          starter:
            "projectTemplates:content.sample-playground.pages.welcome.stopsStarter",
        },
        {
          heading:
            "projectTemplates:content.sample-playground.pages.welcome.notes",
          starter: "-",
        },
        {
          heading:
            "projectTemplates:content.sample-playground.pages.welcome.finished",
          starter:
            "projectTemplates:content.sample-playground.pages.welcome.finishedStarter",
        },
      ],
    },
    {
      key: "shortcuts",
      title: "projectTemplates:content.sample-playground.pages.shortcuts.title",
      logo: { kind: "icon", value: "Star" },
      sections: [
        {
          heading:
            "projectTemplates:content.sample-playground.pages.shortcuts.quickAdd",
          starter:
            "projectTemplates:content.sample-playground.pages.shortcuts.quickAddStarter",
        },
        {
          heading:
            "projectTemplates:content.sample-playground.pages.shortcuts.search",
          starter:
            "projectTemplates:content.sample-playground.pages.shortcuts.searchStarter",
        },
        {
          heading:
            "projectTemplates:content.sample-playground.pages.shortcuts.switchViews",
          starter:
            "projectTemplates:content.sample-playground.pages.shortcuts.switchViewsStarter",
        },
        {
          heading:
            "projectTemplates:content.sample-playground.pages.shortcuts.openTask",
          starter:
            "projectTemplates:content.sample-playground.pages.shortcuts.openTaskStarter",
        },
        {
          heading:
            "projectTemplates:content.sample-playground.pages.shortcuts.moveBetween",
          starter:
            "projectTemplates:content.sample-playground.pages.shortcuts.moveBetweenStarter",
        },
      ],
    },
  ],

  sample: {
    cycles: [
      {
        name: "projectTemplates:content.sample-playground.cycles.tourWeek",
        startInDays: 0,
        lengthDays: 7,
      },
    ],
    tasks: [
      {
        key: "stop-1",
        title: "projectTemplates:content.sample-playground.samples.stop1",
        description:
          "projectTemplates:content.sample-playground.samples.stop1Description",
        column: "todo",
        priority: "high",
        labels: ["tour", "try-it"],
        assignee: "creator",
        dueInDays: 0,
        customFields: { "tour-stop": "1" },
      },
      {
        key: "stop-2",
        title: "projectTemplates:content.sample-playground.samples.stop2",
        description:
          "projectTemplates:content.sample-playground.samples.stop2Description",
        column: "todo",
        priority: "medium",
        labels: ["tour"],
        dueInDays: 1,
        customFields: { "tour-stop": "2" },
      },
      {
        key: "stop-3",
        title: "projectTemplates:content.sample-playground.samples.stop3",
        description:
          "projectTemplates:content.sample-playground.samples.stop3Description",
        column: "todo",
        priority: "medium",
        labels: ["tour", "try-it"],
        assignee: "creator",
        dueInDays: 2,
        customFields: { "tour-stop": "3" },
        subtasks: [
          "projectTemplates:content.sample-playground.samples.saveView",
        ],
      },
      {
        key: "stop-4",
        title: "projectTemplates:content.sample-playground.samples.stop4",
        description:
          "projectTemplates:content.sample-playground.samples.stop4Description",
        column: "todo",
        priority: "medium",
        labels: ["tour", "try-it"],
        dueInDays: 3,
        estimateValue: "3",
        customFields: { "tour-stop": "4" },
        cycle: 0,
      },
      {
        key: "stop-5",
        title: "projectTemplates:content.sample-playground.samples.stop5",
        description:
          "projectTemplates:content.sample-playground.samples.stop5Description",
        column: "backlog",
        priority: "low",
        labels: ["tour"],
        customFields: { "tour-stop": "5" },
        module: "basics",
      },
      {
        key: "stop-6",
        title: "projectTemplates:content.sample-playground.samples.stop6",
        description:
          "projectTemplates:content.sample-playground.samples.stop6Description",
        column: "todo",
        priority: "low",
        labels: ["tour", "try-it"],
        dueInDays: 4,
        customFields: { "tour-stop": "6" },
      },
      {
        key: "stop-7",
        title: "projectTemplates:content.sample-playground.samples.stop7",
        description:
          "projectTemplates:content.sample-playground.samples.stop7Description",
        column: "todo",
        priority: "low",
        labels: ["tour", "try-it"],
        dueInDays: 5,
        customFields: { "tour-stop": "7" },
      },
      {
        key: "stop-8",
        title: "projectTemplates:content.sample-playground.samples.stop8",
        description:
          "projectTemplates:content.sample-playground.samples.stop8Description",
        column: "backlog",
        priority: "no-priority",
        labels: ["tour", "going-further"],
        customFields: { "tour-stop": "8" },
      },
    ],
  },
};

export default template;
