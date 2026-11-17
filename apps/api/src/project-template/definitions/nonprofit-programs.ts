import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/nonprofit-programs.md
//
// Programs are modules, but the engine creates template modules in every
// project, not only with sample data, so the template ships none: teams add
// their own programs, and the plan keeps seeded sample modules under Later.

const c = "projectTemplates:content.nonprofit-programs";

const template: ProjectTemplate = {
  id: "nonprofit-programs",
  version: 1,
  categories: ["nonprofit", "work-management"],
  icon: "Heart",
  name: "projectTemplates:catalog.nonprofit-programs.name",
  pitch: "projectTemplates:catalog.nonprofit-programs.pitch",
  description: "projectTemplates:catalog.nonprofit-programs.description",
  suggestedKey: "PRG",

  project: {
    description: `${c}.projectDescription`,
    features: {
      cycles: false,
      modules: true,
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
      key: "ideas",
      name: "projectTemplates:common.statuses.ideas",
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
    { key: "session", name: `${c}.labels.session`, color: "green" },
    { key: "outreach", name: `${c}.labels.outreach`, color: "teal" },
    { key: "volunteers", name: `${c}.labels.volunteers`, color: "yellow" },
    { key: "evaluation", name: `${c}.labels.evaluation`, color: "purple" },
  ],

  customFields: [
    { key: "participants", name: `${c}.fields.participants`, type: "number" },
    {
      key: "volunteer-hours",
      name: `${c}.fields.volunteerHours`,
      type: "number",
    },
    {
      key: "location",
      name: "projectTemplates:common.fields.location",
      type: "text",
    },
  ],

  views: [
    {
      name: `${c}.views.programCalendar`,
      filters: {
        root: { key: "group", operator: "notIn", values: ["cancelled"] },
      },
      display: { layout: "calendar", groupBy: null },
    },
    {
      name: `${c}.views.byProgram`,
      filters: {
        root: { key: "group", operator: "notIn", values: ["cancelled"] },
      },
      display: {
        layout: "list",
        groupBy: "module",
        orderBy: { field: "dueDate", direction: "asc" },
      },
    },
    {
      name: `${c}.views.outputs`,
      description: `${c}.views.outputsDescription`,
      filters: {
        root: { key: "status", operator: "in", columns: ["done"] },
      },
      display: {
        layout: "spreadsheet",
        groupBy: "module",
        orderBy: { field: "dueDate", direction: "asc" },
      },
      displayProperties: {
        modules: true,
        labels: true,
        dueDate: true,
        customFields: ["participants", "volunteer-hours", "location"],
      },
    },
  ],

  taskTemplates: [
    {
      name: `${c}.taskTemplates.session.name`,
      description: `${c}.taskTemplates.session.description`,
      priority: "medium",
      labels: ["session"],
    },
    {
      name: `${c}.taskTemplates.outcomesCheck.name`,
      description: `${c}.taskTemplates.outcomesCheck.description`,
      priority: "medium",
      labels: ["evaluation"],
    },
  ],

  automationRules: [
    {
      name: `${c}.rules.recordOutputs`,
      trigger: { type: "status_changed", to: ["done"] },
      conditions: {
        op: "and",
        conditions: [{ field: "labels", op: "contains", labels: ["session"] }],
      },
      actions: [{ type: "add_comment", template: `${c}.rules.recordComment` }],
    },
  ],

  pages: [
    {
      key: "program-plan",
      title: `${c}.pages.programPlan.title`,
      logo: { kind: "icon", value: "Target" },
      sections: [
        {
          heading: `${c}.pages.programPlan.need`,
          starter: `${c}.pages.programPlan.needStarter`,
        },
        { heading: `${c}.pages.programPlan.whoItServes`, starter: "-" },
        { heading: `${c}.pages.programPlan.activities`, starter: "-" },
        {
          heading: `${c}.pages.programPlan.outputs`,
          starter: `${c}.pages.programPlan.outputsStarter`,
        },
        {
          heading: `${c}.pages.programPlan.outcomes`,
          starter: `${c}.pages.programPlan.outcomesStarter`,
        },
        { heading: `${c}.pages.programPlan.assumptions`, starter: "-" },
      ],
    },
    {
      key: "volunteer-guide",
      title: `${c}.pages.volunteerGuide.title`,
      logo: { kind: "icon", value: "Users" },
      sections: [
        { heading: "projectTemplates:common.pages.roles", starter: "-" },
        {
          heading: `${c}.pages.volunteerGuide.schedules`,
          starter: `${c}.pages.volunteerGuide.schedulesStarter`,
        },
        { heading: "projectTemplates:common.pages.whoToCall", starter: "-" },
        {
          heading: `${c}.pages.volunteerGuide.safety`,
          starter: `${c}.pages.volunteerGuide.safetyStarter`,
        },
      ],
    },
    {
      key: "safeguarding",
      title: `${c}.pages.safeguarding.title`,
      logo: { kind: "icon", value: "Shield" },
      sections: [
        {
          heading: `${c}.pages.safeguarding.keepSafe`,
          starter: `${c}.pages.safeguarding.keepSafeStarter`,
        },
        {
          heading: `${c}.pages.safeguarding.reportConcern`,
          starter: `${c}.pages.safeguarding.reportConcernStarter`,
        },
        { heading: "projectTemplates:common.pages.whoToCall", starter: "-" },
      ],
    },
  ],

  sample: {
    tasks: [
      {
        key: "coding-week-3",
        title: `${c}.samples.codingWeek3`,
        description: `${c}.samples.codingWeek3Description`,
        column: "done",
        priority: "medium",
        labels: ["session"],
        dueInDays: -4,
        customFields: {
          participants: "14",
          "volunteer-hours": "6",
          location: `${c}.samples.libraryRoom`,
        },
      },
      {
        key: "coding-week-4",
        title: `${c}.samples.codingWeek4`,
        column: "scheduled",
        priority: "medium",
        labels: ["session"],
        assignee: "creator",
        dueInDays: 3,
        customFields: { location: `${c}.samples.libraryRoom` },
        relations: [{ type: "related", to: "coding-week-3" }],
      },
      {
        key: "food-bank-volunteers",
        title: `${c}.samples.foodBankVolunteers`,
        description: `${c}.samples.foodBankVolunteersDescription`,
        column: "in-progress",
        priority: "high",
        labels: ["volunteers"],
        assignee: "creator",
        startInDays: -2,
        dueInDays: 9,
      },
      {
        key: "job-skills-flyers",
        title: `${c}.samples.jobSkillsFlyers`,
        column: "scheduled",
        priority: "medium",
        labels: ["outreach"],
        dueInDays: 7,
      },
      {
        key: "spring-survey",
        title: `${c}.samples.springSurvey`,
        description: `${c}.samples.springSurveyDescription`,
        column: "scheduled",
        priority: "medium",
        labels: ["evaluation"],
        dueInDays: 21,
      },
      {
        key: "cooking-workshop",
        title: `${c}.samples.cookingWorkshop`,
        column: "ideas",
        priority: "low",
        labels: ["session"],
      },
    ],
  },
};

export default template;
