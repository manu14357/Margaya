import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/outcome-tree.md

const template: ProjectTemplate = {
  id: "outcome-tree",
  version: 1,
  categories: ["product-management", "software-development"],
  icon: "Target",
  name: "projectTemplates:catalog.outcome-tree.name",
  pitch: "projectTemplates:catalog.outcome-tree.pitch",
  description: "projectTemplates:catalog.outcome-tree.description",
  suggestedKey: "TREE",

  project: {
    description: "projectTemplates:content.outcome-tree.projectDescription",
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
      key: "mapped",
      name: "projectTemplates:content.outcome-tree.statuses.mapped",
      group: "backlog",
    },
    {
      key: "chosen",
      name: "projectTemplates:content.outcome-tree.statuses.chosen",
      group: "unstarted",
    },
    {
      key: "exploring",
      name: "projectTemplates:content.outcome-tree.statuses.exploring",
      group: "started",
    },
    {
      key: "confirmed",
      name: "projectTemplates:common.statuses.confirmed",
      group: "completed",
    },
    {
      key: "discarded",
      name: "projectTemplates:content.outcome-tree.statuses.discarded",
      group: "cancelled",
    },
  ],

  labels: [
    {
      key: "outcome",
      name: "projectTemplates:content.outcome-tree.labels.outcome",
      color: "green",
    },
    {
      key: "opportunity",
      name: "projectTemplates:content.outcome-tree.labels.opportunity",
      color: "teal",
    },
    {
      key: "solution",
      name: "projectTemplates:content.outcome-tree.labels.solution",
      color: "purple",
    },
    {
      key: "assumption-test",
      name: "projectTemplates:content.outcome-tree.labels.assumptionTest",
      color: "yellow",
    },
  ],

  customFields: [
    {
      key: "metric",
      name: "projectTemplates:content.outcome-tree.fields.metric",
      type: "text",
    },
    {
      key: "opportunity-size",
      name: "projectTemplates:content.outcome-tree.fields.opportunitySize",
      type: "dropdown",
      // Sizes, not confidence levels: common.options.medium is a confidence
      // word with a different grammatical agreement in several locales.
      options: [
        {
          key: "large",
          label:
            "projectTemplates:content.outcome-tree.options.opportunitySize.large",
        },
        {
          key: "medium",
          label:
            "projectTemplates:content.outcome-tree.options.opportunitySize.medium",
        },
        {
          key: "small",
          label:
            "projectTemplates:content.outcome-tree.options.opportunitySize.small",
        },
      ],
    },
    {
      key: "test-result",
      name: "projectTemplates:common.fields.testResult",
      type: "dropdown",
      options: [
        {
          key: "pending",
          label:
            "projectTemplates:content.outcome-tree.options.testResult.pending",
        },
        {
          key: "passed",
          label:
            "projectTemplates:content.outcome-tree.options.testResult.passed",
        },
        {
          key: "failed",
          label:
            "projectTemplates:content.outcome-tree.options.testResult.failed",
        },
        {
          key: "mixed",
          label:
            "projectTemplates:content.outcome-tree.options.testResult.mixed",
        },
      ],
    },
  ],

  views: [
    {
      name: "projectTemplates:content.outcome-tree.views.tree",
      description:
        "projectTemplates:content.outcome-tree.views.treeDescription",
      filters: {
        root: { key: "label", operator: "in", labels: ["outcome"] },
      },
      display: {
        layout: "list",
        groupBy: null,
        orderBy: { field: "manual" },
        showSubTasks: true,
      },
    },
    {
      name: "projectTemplates:content.outcome-tree.views.opportunities",
      filters: {
        root: {
          op: "and",
          children: [
            { key: "label", operator: "in", labels: ["opportunity"] },
            { key: "group", operator: "notIn", values: ["cancelled"] },
          ],
        },
      },
      display: {
        layout: "list",
        groupBy: { customField: "opportunity-size" },
      },
    },
    {
      name: "projectTemplates:content.outcome-tree.views.testsThisWeek",
      filters: {
        root: {
          op: "and",
          children: [
            { key: "label", operator: "in", labels: ["assumption-test"] },
            {
              key: "status",
              operator: "in",
              columns: ["exploring", "chosen"],
            },
          ],
        },
      },
      display: {
        layout: "list",
        groupBy: { customField: "test-result" },
      },
    },
    {
      name: "projectTemplates:content.outcome-tree.views.learningLog",
      filters: {
        root: {
          key: "group",
          operator: "in",
          values: ["completed", "cancelled"],
        },
      },
      display: {
        layout: "list",
        groupBy: "status",
        orderBy: { field: "completedAt", direction: "desc" },
      },
    },
  ],

  taskTemplates: [
    {
      name: "projectTemplates:content.outcome-tree.taskTemplates.outcome.name",
      description:
        "projectTemplates:content.outcome-tree.taskTemplates.outcome.description",
      priority: "high",
      labels: ["outcome"],
    },
    {
      name: "projectTemplates:content.outcome-tree.taskTemplates.opportunity.name",
      description:
        "projectTemplates:content.outcome-tree.taskTemplates.opportunity.description",
      priority: "medium",
      labels: ["opportunity"],
    },
    {
      name: "projectTemplates:content.outcome-tree.taskTemplates.solution.name",
      description:
        "projectTemplates:content.outcome-tree.taskTemplates.solution.description",
      priority: "medium",
      labels: ["solution"],
    },
    {
      name: "projectTemplates:content.outcome-tree.taskTemplates.assumptionTest.name",
      titlePattern:
        "projectTemplates:content.outcome-tree.taskTemplates.assumptionTest.titlePattern",
      description:
        "projectTemplates:content.outcome-tree.taskTemplates.assumptionTest.description",
      priority: "medium",
      labels: ["assumption-test"],
    },
  ],

  automationRules: [
    {
      name: "projectTemplates:content.outcome-tree.rules.solutionGetsTest",
      trigger: { type: "label_added", labels: ["solution"] },
      actions: [
        {
          type: "create_subtask",
          title:
            "projectTemplates:content.outcome-tree.rules.solutionTestTitle",
        },
      ],
    },
    {
      name: "projectTemplates:content.outcome-tree.rules.failedClosesBranch",
      trigger: { type: "status_changed", to: ["discarded"] },
      conditions: {
        op: "and",
        conditions: [{ field: "labels", op: "contains", labels: ["solution"] }],
      },
      actions: [
        {
          type: "add_comment",
          template:
            "projectTemplates:content.outcome-tree.rules.failedClosesBranchComment",
        },
      ],
    },
  ],

  pages: [
    {
      key: "how-to-grow",
      title: "projectTemplates:content.outcome-tree.pages.howToGrow.title",
      logo: { kind: "icon", value: "BookOpen" },
      sections: [
        {
          heading:
            "projectTemplates:content.outcome-tree.pages.howToGrow.oneOutcome",
          starter:
            "projectTemplates:content.outcome-tree.pages.howToGrow.oneOutcomeStarter",
        },
        {
          heading:
            "projectTemplates:content.outcome-tree.pages.howToGrow.realStories",
          starter:
            "projectTemplates:content.outcome-tree.pages.howToGrow.realStoriesStarter",
        },
        {
          heading:
            "projectTemplates:content.outcome-tree.pages.howToGrow.threeSolutions",
          starter:
            "projectTemplates:content.outcome-tree.pages.howToGrow.threeSolutionsStarter",
        },
        {
          heading:
            "projectTemplates:content.outcome-tree.pages.howToGrow.testFirst",
          starter:
            "projectTemplates:content.outcome-tree.pages.howToGrow.testFirstStarter",
        },
        {
          heading:
            "projectTemplates:content.outcome-tree.pages.howToGrow.weekly",
          starter:
            "projectTemplates:content.outcome-tree.pages.howToGrow.weeklyStarter",
        },
      ],
    },
    {
      key: "interview-snapshot",
      title:
        "projectTemplates:content.outcome-tree.pages.interviewSnapshot.title",
      logo: { kind: "icon", value: "MessageSquare" },
      sections: [
        {
          heading:
            "projectTemplates:content.outcome-tree.pages.interviewSnapshot.who",
          starter:
            "projectTemplates:content.outcome-tree.pages.interviewSnapshot.whoStarter",
        },
        {
          heading:
            "projectTemplates:content.outcome-tree.pages.interviewSnapshot.story",
          starter: "",
        },
        {
          heading:
            "projectTemplates:content.outcome-tree.pages.interviewSnapshot.opportunities",
          starter: "-",
        },
        {
          heading:
            "projectTemplates:content.outcome-tree.pages.interviewSnapshot.quote",
          starter: "",
        },
      ],
    },
  ],

  whiteboards: [
    {
      title: "projectTemplates:content.outcome-tree.boards.treeSketch",
      icon: "🌳",
      board: "flowchart",
    },
  ],

  // Sample subtasks share their parent's column and carry no labels, so the
  // tree's levels are separate tasks linked to their parent as related.
  sample: {
    tasks: [
      {
        key: "outcome",
        title: "projectTemplates:content.outcome-tree.samples.outcome",
        description:
          "projectTemplates:content.outcome-tree.samples.outcomeDescription",
        column: "exploring",
        priority: "high",
        labels: ["outcome"],
        assignee: "creator",
        dueInDays: 84,
        customFields: {
          metric: "projectTemplates:content.outcome-tree.samples.outcomeMetric",
        },
      },
      {
        key: "unknown-colleague",
        title: "projectTemplates:content.outcome-tree.samples.unknownColleague",
        description:
          "projectTemplates:content.outcome-tree.samples.unknownColleagueDescription",
        column: "chosen",
        priority: "medium",
        labels: ["opportunity"],
        customFields: { "opportunity-size": "large" },
        relations: [{ type: "related", to: "outcome" }],
      },
      {
        key: "domain-suggestions",
        title:
          "projectTemplates:content.outcome-tree.samples.domainSuggestions",
        column: "exploring",
        priority: "medium",
        labels: ["solution"],
        relations: [{ type: "related", to: "unknown-colleague" }],
      },
      {
        key: "accept-test",
        title: "projectTemplates:content.outcome-tree.samples.acceptTest",
        description:
          "projectTemplates:content.outcome-tree.samples.acceptTestDescription",
        column: "exploring",
        priority: "medium",
        labels: ["assumption-test"],
        startInDays: -1,
        dueInDays: 4,
        customFields: { "test-result": "pending" },
        relations: [{ type: "related", to: "domain-suggestions" }],
      },
      {
        key: "invite-card",
        title: "projectTemplates:content.outcome-tree.samples.inviteCard",
        column: "mapped",
        priority: "low",
        labels: ["solution"],
        relations: [{ type: "related", to: "unknown-colleague" }],
      },
      {
        key: "feels-committing",
        title: "projectTemplates:content.outcome-tree.samples.feelsCommitting",
        column: "mapped",
        priority: "medium",
        labels: ["opportunity"],
        customFields: { "opportunity-size": "medium" },
        relations: [{ type: "related", to: "outcome" }],
      },
    ],
  },
};

export default template;
