import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/event-planning.md

const C = "projectTemplates:content.event-planning";

const template: ProjectTemplate = {
  id: "event-planning",
  version: 1,
  categories: ["marketing", "work-management"],
  icon: "Calendar",
  name: "projectTemplates:catalog.event-planning.name",
  pitch: "projectTemplates:catalog.event-planning.pitch",
  description: "projectTemplates:catalog.event-planning.description",
  suggestedKey: "EVT",

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
      key: "ideas",
      name: "projectTemplates:common.statuses.ideas",
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
      key: "waiting",
      name: "projectTemplates:common.statuses.waiting",
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
    { key: "venue", name: `${C}.labels.venue`, color: "green" },
    { key: "program", name: `${C}.labels.program`, color: "purple" },
    { key: "vendors", name: `${C}.labels.vendors`, color: "yellow" },
    {
      key: "promotion",
      name: "projectTemplates:common.labels.promotion",
      color: "teal",
    },
    { key: "on-the-day", name: `${C}.labels.onTheDay`, color: "red" },
  ],

  customFields: [
    {
      key: "cost",
      name: "projectTemplates:common.fields.cost",
      type: "number",
    },
    { key: "vendor", name: `${C}.fields.vendor`, type: "text" },
    {
      key: "contract-signed",
      name: `${C}.fields.contractSigned`,
      type: "boolean",
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
        groupBy: null,
        orderBy: { field: "startDate", direction: "asc" },
      },
    },
    {
      name: `${C}.views.countdown`,
      description: `${C}.views.countdownDescription`,
      filters: {
        root: {
          key: "group",
          operator: "notIn",
          values: ["completed", "cancelled"],
        },
      },
      display: {
        layout: "list",
        groupBy: null,
        orderBy: { field: "dueDate", direction: "asc" },
      },
      displayProperties: { dueDate: true, assignee: true, labels: true },
    },
    {
      name: `${C}.views.budget`,
      description: `${C}.views.budgetDescription`,
      filters: {
        root: { key: "group", operator: "notIn", values: ["cancelled"] },
      },
      display: { layout: "spreadsheet", groupBy: "label" },
      displayProperties: {
        labels: true,
        customFields: ["vendor", "cost", "contract-signed"],
      },
    },
    {
      name: "projectTemplates:common.views.calendar",
      filters: {
        root: { key: "group", operator: "notIn", values: ["cancelled"] },
      },
      display: { layout: "calendar", groupBy: null },
    },
  ],

  taskTemplates: [
    {
      name: `${C}.taskTemplates.vendorBooking.name`,
      description: `${C}.taskTemplates.vendorBooking.description`,
      priority: "high",
      labels: ["vendors"],
    },
    {
      name: `${C}.taskTemplates.speaker.name`,
      description: `${C}.taskTemplates.speaker.description`,
      priority: "medium",
      labels: ["program"],
    },
  ],

  automationRules: [
    {
      name: `${C}.rules.followUp`,
      trigger: { type: "status_changed", to: ["waiting"] },
      actions: [
        { type: "set_due_date", offsetDays: 3 },
        { type: "add_comment", template: `${C}.rules.followUpComment` },
      ],
    },
    {
      name: `${C}.rules.overdue`,
      trigger: { type: "due_date_passed" },
      conditions: {
        op: "and",
        conditions: [
          { field: "status", op: "is_not", columns: ["done", "cancelled"] },
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

  pages: [
    {
      key: "brief",
      title: `${C}.pages.brief.title`,
      logo: { kind: "icon", value: "FileText" },
      sections: [
        {
          heading: "projectTemplates:common.pages.purpose",
          starter: `${C}.pages.brief.purposeStarter`,
        },
        { heading: "projectTemplates:common.pages.audience", starter: "" },
        {
          heading: `${C}.pages.brief.date`,
          starter: `${C}.pages.brief.dateStarter`,
        },
        { heading: `${C}.pages.brief.headcount`, starter: "" },
        {
          heading: "projectTemplates:common.pages.budget",
          starter: `${C}.pages.brief.budgetStarter`,
        },
        {
          heading: "projectTemplates:common.pages.successMeasures",
          starter: "-",
        },
      ],
    },
    {
      key: "run-of-show",
      title: `${C}.pages.runOfShow.title`,
      logo: { kind: "icon", value: "Timer" },
      sections: [
        {
          heading: `${C}.pages.runOfShow.schedule`,
          starter: `${C}.pages.runOfShow.scheduleStarter`,
        },
        {
          heading: `${C}.pages.runOfShow.cues`,
          starter: `${C}.pages.runOfShow.cuesStarter`,
        },
        {
          heading: "projectTemplates:common.pages.roles",
          starter: "-",
        },
      ],
    },
    {
      key: "contacts",
      title: `${C}.pages.contacts.title`,
      logo: { kind: "icon", value: "Phone" },
      sections: [
        {
          heading: `${C}.pages.contacts.vendors`,
          starter: `${C}.pages.contacts.vendorsStarter`,
        },
        { heading: `${C}.pages.contacts.onSite`, starter: "-" },
        {
          heading: "projectTemplates:common.pages.whoToCall",
          starter: `${C}.pages.contacts.whoToCallStarter`,
        },
      ],
    },
    {
      key: "after",
      title: `${C}.pages.after.title`,
      logo: { kind: "icon", value: "Star" },
      sections: [
        { heading: `${C}.pages.after.attendance`, starter: "" },
        { heading: `${C}.pages.after.feedback`, starter: "-" },
        {
          heading: `${C}.pages.after.spend`,
          starter: `${C}.pages.after.spendStarter`,
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
        key: "venue",
        title: `${C}.samples.venue`,
        description: `${C}.samples.venueDescription`,
        column: "done",
        priority: "high",
        labels: ["venue"],
        startInDays: -30,
        dueInDays: -20,
        customFields: {
          vendor: `${C}.samples.venueVendor`,
          cost: "4200",
          "contract-signed": "true",
        },
      },
      {
        key: "catering",
        title: `${C}.samples.catering`,
        description: `${C}.samples.cateringDescription`,
        column: "waiting",
        priority: "high",
        labels: ["vendors"],
        assignee: "creator",
        startInDays: -10,
        dueInDays: 3,
        customFields: {
          vendor: `${C}.samples.cateringVendor`,
          cost: "3100",
          "contract-signed": "false",
        },
      },
      {
        key: "keynote",
        title: `${C}.samples.keynote`,
        column: "in-progress",
        priority: "high",
        labels: ["program"],
        assignee: "creator",
        startInDays: -7,
        dueInDays: 7,
        relations: [{ type: "finish_before", to: "registration" }],
      },
      {
        key: "registration",
        title: `${C}.samples.registration`,
        description: `${C}.samples.registrationDescription`,
        column: "todo",
        priority: "high",
        labels: ["promotion"],
        startInDays: 8,
        dueInDays: 12,
      },
      {
        key: "sound",
        title: `${C}.samples.sound`,
        column: "todo",
        priority: "medium",
        labels: ["vendors"],
        startInDays: 10,
        dueInDays: 24,
      },
      {
        key: "run-of-show",
        title: `${C}.samples.runOfShow`,
        column: "todo",
        priority: "medium",
        labels: ["on-the-day"],
        startInDays: 30,
        dueInDays: 40,
      },
      {
        key: "thank-you",
        title: `${C}.samples.thankYou`,
        column: "todo",
        priority: "low",
        labels: ["on-the-day"],
        startInDays: 46,
        dueInDays: 48,
      },
    ],
  },
};

export default template;
