import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/rfp-process.md

const C = "projectTemplates:content.rfp-process";

const template: ProjectTemplate = {
  id: "rfp-process",
  version: 1,
  categories: ["finance", "operations", "work-management"],
  icon: "Trophy",
  name: "projectTemplates:catalog.rfp-process.name",
  pitch: "projectTemplates:catalog.rfp-process.pitch",
  description: "projectTemplates:catalog.rfp-process.description",
  suggestedKey: "RFP",

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
      updates: false,
    },
    lead: "creator",
  },

  columns: [
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
      key: "cancelled",
      name: "projectTemplates:common.statuses.cancelled",
      group: "cancelled",
    },
  ],

  labels: [
    {
      key: "supplier-question",
      name: `${C}.labels.supplierQuestion`,
      color: "purple",
    },
    { key: "addendum", name: `${C}.labels.addendum`, color: "yellow" },
    { key: "scoring", name: `${C}.labels.scoring`, color: "teal" },
    {
      key: "decision",
      name: "projectTemplates:common.labels.decision",
      color: "green",
    },
  ],

  customFields: [
    {
      key: "stage",
      name: `${C}.fields.stage`,
      type: "dropdown",
      options: [
        { key: "prepare", label: `${C}.options.stage.prepare` },
        { key: "issue", label: `${C}.options.stage.issue` },
        { key: "questions", label: `${C}.options.stage.questions` },
        { key: "evaluate", label: `${C}.options.stage.evaluate` },
        { key: "award", label: `${C}.options.stage.award` },
      ],
    },
    {
      key: "supplier",
      name: "projectTemplates:common.fields.supplier",
      type: "text",
    },
    {
      key: "score",
      name: "projectTemplates:common.fields.score",
      type: "number",
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
        groupBy: { customField: "stage" },
        orderBy: { field: "startDate", direction: "asc" },
      },
    },
    {
      name: `${C}.views.questionLog`,
      description: `${C}.views.questionLogDescription`,
      filters: {
        root: { key: "label", operator: "in", labels: ["supplier-question"] },
      },
      display: {
        layout: "list",
        groupBy: null,
        orderBy: { field: "createdAt", direction: "asc" },
      },
    },
    {
      name: `${C}.views.scoring`,
      description: `${C}.views.scoringDescription`,
      filters: {
        root: { key: "label", operator: "in", labels: ["scoring"] },
      },
      display: {
        layout: "spreadsheet",
        groupBy: { customField: "supplier" },
      },
      displayProperties: {
        status: true,
        assignee: true,
        priority: false,
        labels: false,
        customFields: ["score"],
      },
    },
  ],

  taskTemplates: [
    {
      name: `${C}.taskTemplates.supplierQuestion.name`,
      titlePattern: `${C}.taskTemplates.supplierQuestion.titlePattern`,
      description: `${C}.taskTemplates.supplierQuestion.description`,
      priority: "high",
      labels: ["supplier-question"],
    },
    {
      name: `${C}.taskTemplates.evaluateProposal.name`,
      titlePattern: `${C}.taskTemplates.evaluateProposal.titlePattern`,
      description: `${C}.taskTemplates.evaluateProposal.description`,
      priority: "medium",
      labels: ["scoring"],
    },
  ],

  automationRules: [
    {
      name: `${C}.rules.questionDue`,
      trigger: { type: "label_added", labels: ["supplier-question"] },
      actions: [
        { type: "set_due_date", offsetDays: 3 },
        {
          type: "notify",
          roles: ["lead"],
          message: `${C}.rules.questionMessage`,
        },
      ],
    },
    {
      name: `${C}.rules.addendumReminder`,
      trigger: { type: "label_added", labels: ["addendum"] },
      actions: [
        { type: "add_comment", template: `${C}.rules.addendumComment` },
      ],
    },
  ],

  pages: [
    {
      key: "brief",
      title: `${C}.pages.brief.title`,
      logo: { kind: "icon", value: "FileText" },
      sections: [
        {
          heading: "projectTemplates:common.pages.scope",
          starter: `${C}.pages.brief.scopeStarter`,
        },
        { heading: `${C}.pages.brief.requirements`, starter: "- [ ]" },
        {
          heading: "projectTemplates:common.pages.timeline",
          starter: `${C}.pages.brief.timelineStarter`,
        },
        {
          heading: `${C}.pages.brief.submissionRules`,
          starter: `${C}.pages.brief.submissionRulesStarter`,
        },
        {
          heading: "projectTemplates:common.pages.whoToCall",
          starter: `${C}.pages.brief.contactStarter`,
        },
      ],
    },
    {
      key: "criteria",
      title: `${C}.pages.criteria.title`,
      logo: { kind: "icon", value: "Table" },
      sections: [
        {
          heading: `${C}.pages.criteria.weights`,
          starter: `${C}.pages.criteria.weightsStarter`,
        },
        {
          heading: `${C}.pages.criteria.scale`,
          starter: `${C}.pages.criteria.scaleStarter`,
        },
        {
          heading: `${C}.pages.criteria.fixed`,
          starter: `${C}.pages.criteria.fixedStarter`,
        },
      ],
    },
  ],

  sample: {
    tasks: [
      {
        key: "requirements",
        title: `${C}.samples.requirements`,
        column: "done",
        priority: "high",
        startInDays: -28,
        dueInDays: -21,
        customFields: { stage: "prepare" },
      },
      {
        key: "criteria",
        title: `${C}.samples.criteria`,
        description: `${C}.samples.criteriaDescription`,
        column: "done",
        priority: "high",
        labels: ["decision"],
        startInDays: -21,
        dueInDays: -18,
        customFields: { stage: "prepare" },
      },
      {
        key: "publish",
        title: `${C}.samples.publish`,
        column: "done",
        priority: "high",
        startInDays: -16,
        dueInDays: -14,
        isMilestone: true,
        customFields: { stage: "issue" },
      },
      {
        key: "onsite-question",
        title: `${C}.samples.onsiteQuestion`,
        description: `${C}.samples.onsiteQuestionDescription`,
        column: "in-review",
        priority: "high",
        labels: ["supplier-question"],
        assignee: "creator",
        startInDays: -2,
        dueInDays: 1,
        customFields: { stage: "questions" },
      },
      {
        key: "addendum",
        title: `${C}.samples.addendum`,
        description: `${C}.samples.addendumDescription`,
        column: "todo",
        priority: "medium",
        labels: ["addendum"],
        startInDays: 1,
        dueInDays: 3,
        customFields: { stage: "questions" },
      },
      {
        key: "score-b",
        title: `${C}.samples.scoreB`,
        column: "in-progress",
        priority: "medium",
        labels: ["scoring"],
        startInDays: 7,
        dueInDays: 14,
        customFields: {
          stage: "evaluate",
          supplier: `${C}.samples.supplierB`,
        },
        relations: [{ type: "finish_before", to: "consensus" }],
      },
      {
        key: "consensus",
        title: `${C}.samples.consensus`,
        column: "todo",
        priority: "high",
        labels: ["decision"],
        startInDays: 16,
        dueInDays: 17,
        customFields: { stage: "evaluate" },
        relations: [{ type: "blocks", to: "award" }],
      },
      {
        key: "award",
        title: `${C}.samples.award`,
        description: `${C}.samples.awardDescription`,
        column: "todo",
        priority: "medium",
        startInDays: 20,
        dueInDays: 24,
        isMilestone: true,
        customFields: { stage: "award" },
      },
    ],
  },
};

export default template;
