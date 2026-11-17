import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/personal-planner.md

const template: ProjectTemplate = {
  id: "personal-planner",
  version: 1,
  categories: ["personal", "work-management"],
  icon: "User",
  name: "projectTemplates:catalog.personal-planner.name",
  pitch: "projectTemplates:catalog.personal-planner.pitch",
  description: "projectTemplates:catalog.personal-planner.description",
  suggestedKey: "ME",

  project: {
    description: "projectTemplates:content.personal-planner.projectDescription",
    features: {
      cycles: false,
      modules: false,
      views: false,
      pages: false,
      whiteboards: false,
      intake: false,
      estimates: false,
      timeTracking: false,
      ai: false,
      updates: false,
    },
    lead: "creator",
  },

  // Inbox stays first so anything captured lands there without a decision.
  columns: [
    {
      key: "inbox",
      name: "projectTemplates:content.personal-planner.statuses.inbox",
      group: "backlog",
    },
    {
      key: "today",
      name: "projectTemplates:content.personal-planner.statuses.today",
      group: "started",
    },
    {
      key: "this-week",
      name: "projectTemplates:content.personal-planner.statuses.thisWeek",
      group: "unstarted",
    },
    {
      key: "someday",
      name: "projectTemplates:content.personal-planner.statuses.someday",
      group: "backlog",
    },
    {
      key: "done",
      name: "projectTemplates:common.statuses.done",
      group: "completed",
    },
  ],

  labels: [
    {
      key: "waiting",
      name: "projectTemplates:common.labels.waiting",
      color: "gray",
    },
    {
      key: "quick",
      name: "projectTemplates:content.personal-planner.labels.quick",
      color: "green",
    },
  ],

  taskTemplates: [
    {
      name: "projectTemplates:content.personal-planner.taskTemplates.weeklyReview.name",
      titlePattern:
        "projectTemplates:content.personal-planner.taskTemplates.weeklyReview.name",
      description:
        "projectTemplates:content.personal-planner.taskTemplates.weeklyReview.description",
      column: "this-week",
      priority: "medium",
    },
  ],

  sample: {
    tasks: [
      {
        key: "dentist",
        title: "projectTemplates:content.personal-planner.samples.dentist",
        column: "today",
        priority: "medium",
        labels: ["quick"],
        dueInDays: 0,
      },
      {
        key: "bike-rack",
        title: "projectTemplates:content.personal-planner.samples.bikeRack",
        column: "inbox",
        priority: "low",
        labels: ["quick"],
      },
      {
        key: "lease",
        title: "projectTemplates:content.personal-planner.samples.lease",
        description:
          "projectTemplates:content.personal-planner.samples.leaseDescription",
        column: "this-week",
        priority: "high",
        dueInDays: 4,
      },
      {
        key: "plumber",
        title: "projectTemplates:content.personal-planner.samples.plumber",
        description:
          "projectTemplates:content.personal-planner.samples.plumberDescription",
        column: "this-week",
        priority: "medium",
        labels: ["waiting"],
      },
      {
        key: "hike",
        title: "projectTemplates:content.personal-planner.samples.hike",
        column: "someday",
        priority: "no-priority",
      },
      {
        key: "weekly-review",
        title:
          "projectTemplates:content.personal-planner.taskTemplates.weeklyReview.name",
        description:
          "projectTemplates:content.personal-planner.taskTemplates.weeklyReview.description",
        column: "this-week",
        priority: "medium",
        // The habit the planner depends on: every Sunday, renewed when done.
        recurrence: {
          frequency: "weekly",
          weekdays: [0],
          trigger: "completion",
        },
      },
    ],
  },
};

export default template;
