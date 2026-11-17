import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/scrum.md

const template: ProjectTemplate = {
  id: "scrum",
  version: 1,
  categories: ["software-development", "customer-service"],
  icon: "Timer",
  name: "projectTemplates:catalog.scrum.name",
  pitch: "projectTemplates:catalog.scrum.pitch",
  description: "projectTemplates:catalog.scrum.description",
  suggestedKey: "SCRUM",

  project: {
    description: "projectTemplates:content.scrum.projectDescription",
    features: {
      cycles: true,
      modules: false,
      views: true,
      pages: true,
      whiteboards: false,
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
      key: "wont-do",
      name: "projectTemplates:common.statuses.wontDo",
      group: "cancelled",
    },
  ],

  labels: [
    {
      key: "story",
      name: "projectTemplates:content.scrum.labels.story",
      color: "green",
    },
    {
      key: "bug",
      name: "projectTemplates:content.scrum.labels.bug",
      color: "red",
    },
    {
      key: "spike",
      name: "projectTemplates:content.scrum.labels.spike",
      color: "purple",
    },
    {
      key: "tech-debt",
      name: "projectTemplates:content.scrum.labels.techDebt",
      color: "dark-gray",
    },
  ],

  estimate: {
    name: "projectTemplates:content.scrum.estimate.name",
    type: "points",
    values: ["1", "2", "3", "5", "8", "13"],
  },

  views: [
    {
      name: "projectTemplates:content.scrum.views.sprintBoard",
      filters: {
        root: { key: "cycle", operator: "in", values: ["current"] },
      },
      display: { layout: "board", groupBy: "status" },
    },
    {
      name: "projectTemplates:content.scrum.views.refinement",
      description: "projectTemplates:content.scrum.views.refinementDescription",
      filters: {
        root: {
          op: "and",
          children: [
            { key: "cycle", operator: "in", values: ["none"] },
            {
              key: "group",
              operator: "in",
              values: ["backlog", "unstarted"],
            },
          ],
        },
      },
      display: {
        layout: "list",
        groupBy: "status",
        orderBy: { field: "priority", direction: "desc" },
      },
    },
    {
      // The view filter has no estimate condition, so open work is grouped
      // by estimate and the "no estimate" group is the one to size.
      name: "projectTemplates:content.scrum.views.needsEstimate",
      description:
        "projectTemplates:content.scrum.views.needsEstimateDescription",
      filters: {
        root: {
          key: "group",
          operator: "notIn",
          values: ["completed", "cancelled"],
        },
      },
      display: {
        layout: "list",
        groupBy: "estimate",
        orderBy: { field: "priority", direction: "desc" },
      },
    },
    {
      name: "projectTemplates:content.scrum.views.mySprint",
      filters: {
        root: {
          op: "and",
          children: [
            { key: "cycle", operator: "in", values: ["current"] },
            { key: "assignee", operator: "in", values: ["me"] },
          ],
        },
      },
      display: {
        layout: "list",
        groupBy: null,
        orderBy: { field: "status", direction: "asc" },
      },
    },
  ],

  taskTemplates: [
    {
      name: "projectTemplates:content.scrum.taskTemplates.userStory.name",
      description:
        "projectTemplates:content.scrum.taskTemplates.userStory.description",
      priority: "medium",
      labels: ["story"],
    },
    {
      name: "projectTemplates:content.scrum.taskTemplates.bug.name",
      description:
        "projectTemplates:content.scrum.taskTemplates.bug.description",
      priority: "high",
      labels: ["bug"],
    },
    {
      name: "projectTemplates:content.scrum.taskTemplates.spike.name",
      titlePattern:
        "projectTemplates:content.scrum.taskTemplates.spike.titlePattern",
      description:
        "projectTemplates:content.scrum.taskTemplates.spike.description",
      priority: "medium",
      labels: ["spike"],
    },
  ],

  automationRules: [
    {
      // moved_to_cycle is not a template trigger; committing work to the
      // sprint means moving it to To do, so the rule watches that instead.
      name: "projectTemplates:content.scrum.rules.askForEstimate",
      trigger: { type: "status_changed", to: ["todo"] },
      conditions: {
        op: "and",
        conditions: [{ field: "estimate", op: "not_set" }],
      },
      actions: [
        {
          type: "add_comment",
          template:
            "projectTemplates:content.scrum.rules.askForEstimateComment",
        },
      ],
    },
    {
      name: "projectTemplates:content.scrum.rules.bugsToTop",
      trigger: { type: "task_created" },
      conditions: {
        op: "and",
        conditions: [{ field: "labels", op: "contains", labels: ["bug"] }],
      },
      actions: [{ type: "set_priority", priority: "high" }],
    },
  ],

  scheduledAutomations: { cycleRollover: { enabled: true } },

  pages: [
    {
      key: "definition-of-done",
      title: "projectTemplates:content.scrum.pages.definitionOfDone.title",
      logo: { kind: "emoji", value: "✅" },
      sections: [
        {
          heading:
            "projectTemplates:content.scrum.pages.definitionOfDone.checklist",
          starter:
            "projectTemplates:content.scrum.pages.definitionOfDone.checklistStarter",
        },
        {
          heading:
            "projectTemplates:content.scrum.pages.definitionOfDone.notDone",
          starter:
            "projectTemplates:content.scrum.pages.definitionOfDone.notDoneStarter",
        },
      ],
    },
    {
      key: "working-agreement",
      title: "projectTemplates:content.scrum.pages.workingAgreement.title",
      logo: { kind: "icon", value: "Users" },
      sections: [
        {
          heading:
            "projectTemplates:content.scrum.pages.workingAgreement.sprintLength",
          starter:
            "projectTemplates:content.scrum.pages.workingAgreement.sprintLengthStarter",
        },
        {
          heading:
            "projectTemplates:content.scrum.pages.workingAgreement.events",
          starter:
            "projectTemplates:content.scrum.pages.workingAgreement.eventsStarter",
        },
        {
          heading:
            "projectTemplates:content.scrum.pages.workingAgreement.refinement",
          starter:
            "projectTemplates:content.scrum.pages.workingAgreement.refinementStarter",
        },
        {
          heading:
            "projectTemplates:content.scrum.pages.workingAgreement.blockers",
          starter:
            "projectTemplates:content.scrum.pages.workingAgreement.blockersStarter",
        },
      ],
    },
  ],

  sample: {
    cycles: [
      {
        name: "projectTemplates:content.scrum.cycles.sprintOne",
        startInDays: 0,
        lengthDays: 14,
      },
    ],
    tasks: [
      {
        key: "password-reset",
        title: "projectTemplates:content.scrum.samples.passwordReset",
        description:
          "projectTemplates:content.scrum.samples.passwordResetDescription",
        column: "todo",
        priority: "high",
        labels: ["story"],
        estimateValue: "5",
        cycle: 0,
      },
      {
        key: "order-history",
        title: "projectTemplates:content.scrum.samples.orderHistory",
        column: "in-progress",
        priority: "medium",
        labels: ["story"],
        assignee: "creator",
        estimateValue: "8",
        cycle: 0,
        startInDays: 0,
      },
      {
        key: "checkout-button",
        title: "projectTemplates:content.scrum.samples.checkoutButton",
        description:
          "projectTemplates:content.scrum.samples.checkoutButtonDescription",
        column: "in-review",
        priority: "high",
        labels: ["bug"],
        estimateValue: "2",
        cycle: 0,
      },
      {
        key: "search-cache",
        title: "projectTemplates:content.scrum.samples.searchCache",
        column: "todo",
        priority: "medium",
        labels: ["spike"],
        estimateValue: "3",
        cycle: 0,
      },
      {
        key: "v1-export",
        title: "projectTemplates:content.scrum.samples.v1Export",
        column: "backlog",
        priority: "low",
        labels: ["tech-debt"],
      },
      {
        key: "invite-link",
        title: "projectTemplates:content.scrum.samples.inviteLink",
        column: "backlog",
        priority: "medium",
        labels: ["story"],
      },
    ],
  },
};

export default template;
