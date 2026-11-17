import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/ux-design.md

const template: ProjectTemplate = {
  id: "ux-design",
  version: 1,
  categories: ["design", "work-management"],
  icon: "PenTool",
  name: "projectTemplates:catalog.ux-design.name",
  pitch: "projectTemplates:catalog.ux-design.pitch",
  description: "projectTemplates:catalog.ux-design.description",
  suggestedKey: "UX",

  project: {
    description: "projectTemplates:content.ux-design.projectDescription",
    features: {
      cycles: false,
      modules: false,
      views: true,
      pages: true,
      whiteboards: true,
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
      key: "up-next",
      name: "projectTemplates:common.statuses.upNext",
      group: "unstarted",
    },
    {
      key: "discover",
      name: "projectTemplates:content.ux-design.statuses.discover",
      group: "started",
    },
    {
      key: "define",
      name: "projectTemplates:content.ux-design.statuses.define",
      group: "started",
    },
    {
      key: "design",
      name: "projectTemplates:common.statuses.design",
      group: "started",
    },
    {
      key: "test",
      name: "projectTemplates:content.ux-design.statuses.test",
      group: "started",
    },
    {
      key: "ready-for-handoff",
      name: "projectTemplates:content.ux-design.statuses.readyForHandoff",
      group: "started",
    },
    {
      key: "handed-off",
      name: "projectTemplates:content.ux-design.statuses.handedOff",
      group: "completed",
    },
    {
      key: "parked",
      name: "projectTemplates:common.statuses.parked",
      group: "cancelled",
    },
  ],

  labels: [
    {
      key: "research",
      name: "projectTemplates:content.ux-design.labels.research",
      color: "purple",
    },
    {
      key: "usability-issue",
      name: "projectTemplates:content.ux-design.labels.usabilityIssue",
      color: "orange",
    },
    {
      key: "accessibility",
      name: "projectTemplates:content.ux-design.labels.accessibility",
      color: "teal",
    },
    {
      key: "design-system",
      name: "projectTemplates:content.ux-design.labels.designSystem",
      color: "dark-gray",
    },
    {
      key: "quick-win",
      name: "projectTemplates:common.labels.quickWin",
      color: "green",
    },
  ],

  customFields: [
    {
      key: "platform",
      name: "projectTemplates:content.ux-design.fields.platform",
      type: "dropdown",
      options: [
        {
          key: "web",
          label: "projectTemplates:content.ux-design.options.platform.web",
        },
        {
          key: "mobile",
          label: "projectTemplates:content.ux-design.options.platform.mobile",
        },
        { key: "desktop", label: "projectTemplates:common.options.desktop" },
        {
          key: "all",
          label: "projectTemplates:content.ux-design.options.platform.all",
        },
      ],
    },
    {
      key: "prototype-link",
      name: "projectTemplates:content.ux-design.fields.prototypeLink",
      type: "text",
    },
    {
      key: "test-result",
      name: "projectTemplates:common.fields.testResult",
      type: "dropdown",
      options: [
        {
          key: "not-tested",
          label:
            "projectTemplates:content.ux-design.options.testResult.notTested",
        },
        {
          key: "works",
          label: "projectTemplates:content.ux-design.options.testResult.works",
        },
        {
          key: "needs-changes",
          label:
            "projectTemplates:content.ux-design.options.testResult.needsChanges",
        },
      ],
      defaultOption: "not-tested",
    },
  ],

  views: [
    {
      name: "projectTemplates:common.views.designBoard",
      filters: {
        root: { key: "group", operator: "notIn", values: ["cancelled"] },
      },
      display: { layout: "board", groupBy: "status" },
    },
    {
      name: "projectTemplates:content.ux-design.views.testing",
      filters: { root: { key: "status", operator: "in", columns: ["test"] } },
      display: { layout: "list", groupBy: { customField: "test-result" } },
      displayProperties: {
        customFields: ["test-result", "platform", "prototype-link"],
      },
    },
    {
      name: "projectTemplates:content.ux-design.views.handoffQueue",
      filters: {
        root: { key: "status", operator: "in", columns: ["ready-for-handoff"] },
      },
      display: {
        layout: "list",
        groupBy: null,
        orderBy: { field: "priority" },
      },
    },
  ],

  taskTemplates: [
    {
      name: "projectTemplates:content.ux-design.taskTemplates.testRound.name",
      titlePattern:
        "projectTemplates:content.ux-design.taskTemplates.testRound.titlePattern",
      description:
        "projectTemplates:content.ux-design.taskTemplates.testRound.description",
      column: "test",
      priority: "medium",
    },
    {
      name: "projectTemplates:content.ux-design.taskTemplates.handoff.name",
      titlePattern:
        "projectTemplates:content.ux-design.taskTemplates.handoff.titlePattern",
      description:
        "projectTemplates:content.ux-design.taskTemplates.handoff.description",
      column: "ready-for-handoff",
      priority: "high",
    },
  ],

  automationRules: [
    {
      name: "projectTemplates:content.ux-design.rules.walkthrough",
      trigger: { type: "status_changed", to: ["ready-for-handoff"] },
      actions: [
        {
          type: "create_subtask",
          title: "projectTemplates:content.ux-design.rules.walkthroughSubtask",
        },
        {
          type: "notify",
          roles: ["lead"],
          message:
            "projectTemplates:content.ux-design.rules.walkthroughMessage",
        },
      ],
    },
  ],

  pages: [
    {
      key: "research-plan",
      title: "projectTemplates:content.ux-design.pages.researchPlan.title",
      logo: { kind: "icon", value: "Search" },
      sections: [
        {
          heading:
            "projectTemplates:content.ux-design.pages.researchPlan.learn",
          starter:
            "projectTemplates:content.ux-design.pages.researchPlan.learnStarter",
        },
        {
          heading: "projectTemplates:content.ux-design.pages.researchPlan.who",
          starter:
            "projectTemplates:content.ux-design.pages.researchPlan.whoStarter",
        },
        {
          heading:
            "projectTemplates:content.ux-design.pages.researchPlan.methods",
          starter: "-",
        },
        { heading: "projectTemplates:common.pages.timeline", starter: "-" },
      ],
    },
    {
      key: "problem-statement",
      title: "projectTemplates:content.ux-design.pages.problem.title",
      logo: { kind: "icon", value: "Target" },
      sections: [
        {
          heading: "projectTemplates:content.ux-design.pages.problem.who",
          starter: "",
        },
        {
          heading: "projectTemplates:content.ux-design.pages.problem.what",
          starter: "",
        },
        {
          heading: "projectTemplates:content.ux-design.pages.problem.why",
          starter: "",
        },
        {
          heading: "projectTemplates:content.ux-design.pages.problem.solved",
          starter:
            "projectTemplates:content.ux-design.pages.problem.solvedStarter",
        },
      ],
    },
    {
      key: "handoff-guide",
      title: "projectTemplates:content.ux-design.pages.handoff.title",
      logo: { kind: "icon", value: "Share2" },
      sections: [
        {
          heading: "projectTemplates:common.pages.whatToInclude",
          starter:
            "projectTemplates:content.ux-design.pages.handoff.includeStarter",
        },
        {
          heading: "projectTemplates:common.pages.openQuestions",
          starter:
            "projectTemplates:content.ux-design.pages.handoff.questionsStarter",
        },
      ],
    },
  ],

  whiteboards: [
    {
      title: "projectTemplates:content.ux-design.boards.journeyMap",
      icon: "🗺️",
      board: "user-story-map",
    },
    {
      title: "projectTemplates:content.ux-design.boards.affinitySort",
      icon: "🗂️",
      board: "brainstorm",
    },
    {
      title: "projectTemplates:content.ux-design.boards.sketches",
      icon: "✏️",
      board: "blank",
    },
  ],

  sample: {
    tasks: [
      {
        key: "checkout-interviews",
        title: "projectTemplates:content.ux-design.samples.checkoutInterviews",
        description:
          "projectTemplates:content.ux-design.samples.checkoutInterviewsDescription",
        column: "discover",
        priority: "high",
        labels: ["research"],
        assignee: "creator",
        dueInDays: 7,
        customFields: { platform: "mobile" },
      },
      {
        key: "delivery-slots",
        title: "projectTemplates:content.ux-design.samples.deliverySlots",
        column: "define",
        priority: "medium",
        labels: ["research"],
        customFields: { platform: "all" },
      },
      {
        key: "one-tap-reorder",
        title: "projectTemplates:content.ux-design.samples.oneTapReorder",
        description:
          "projectTemplates:content.ux-design.samples.oneTapReorderDescription",
        column: "design",
        priority: "high",
        assignee: "creator",
        customFields: {
          platform: "mobile",
          "prototype-link":
            "projectTemplates:content.ux-design.samples.oneTapReorderPrototype",
        },
      },
      {
        key: "address-form",
        title: "projectTemplates:content.ux-design.samples.addressForm",
        description:
          "projectTemplates:content.ux-design.samples.addressFormDescription",
        column: "test",
        priority: "medium",
        labels: ["usability-issue"],
        customFields: { platform: "web", "test-result": "needs-changes" },
      },
      {
        key: "contrast-fixes",
        title: "projectTemplates:content.ux-design.samples.contrastFixes",
        column: "ready-for-handoff",
        priority: "medium",
        labels: ["accessibility", "design-system"],
        dueInDays: 5,
        subtasks: [
          "projectTemplates:content.ux-design.rules.walkthroughSubtask",
        ],
      },
      {
        key: "saved-lists",
        title: "projectTemplates:content.ux-design.samples.savedLists",
        column: "handed-off",
        priority: "medium",
        customFields: { platform: "web", "test-result": "works" },
      },
    ],
  },
};

export default template;
