import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/grant-tracker.md

const template: ProjectTemplate = {
  id: "grant-tracker",
  version: 1,
  categories: ["nonprofit", "work-management"],
  icon: "Heart",
  name: "projectTemplates:catalog.grant-tracker.name",
  pitch: "projectTemplates:catalog.grant-tracker.pitch",
  description: "projectTemplates:catalog.grant-tracker.description",
  suggestedKey: "GRT",

  project: {
    description: "projectTemplates:content.grant-tracker.projectDescription",
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
      key: "prospect",
      name: "projectTemplates:content.grant-tracker.statuses.prospect",
      group: "unstarted",
    },
    {
      key: "letter-of-inquiry",
      name: "projectTemplates:content.grant-tracker.statuses.letterOfInquiry",
      group: "started",
    },
    {
      key: "drafting",
      name: "projectTemplates:common.statuses.drafting",
      group: "started",
    },
    {
      key: "submitted",
      name: "projectTemplates:common.statuses.submitted",
      group: "started",
    },
    {
      key: "awarded",
      name: "projectTemplates:content.grant-tracker.statuses.awarded",
      group: "started",
    },
    {
      key: "closed-out",
      name: "projectTemplates:content.grant-tracker.statuses.closedOut",
      group: "completed",
    },
    {
      key: "declined",
      name: "projectTemplates:common.statuses.declined",
      group: "cancelled",
    },
  ],

  labels: [
    {
      key: "foundation",
      name: "projectTemplates:content.grant-tracker.labels.foundation",
      color: "green",
    },
    {
      key: "government",
      name: "projectTemplates:content.grant-tracker.labels.government",
      color: "dark-gray",
    },
    {
      key: "corporate",
      name: "projectTemplates:content.grant-tracker.labels.corporate",
      color: "yellow",
    },
    {
      key: "renewal",
      name: "projectTemplates:common.labels.renewal",
      color: "purple",
    },
  ],

  customFields: [
    {
      key: "funder",
      name: "projectTemplates:content.grant-tracker.fields.funder",
      type: "text",
    },
    {
      key: "amount-requested",
      name: "projectTemplates:content.grant-tracker.fields.amountRequested",
      type: "number",
    },
    {
      key: "amount-awarded",
      name: "projectTemplates:content.grant-tracker.fields.amountAwarded",
      type: "number",
    },
    {
      key: "next-report-due",
      name: "projectTemplates:content.grant-tracker.fields.nextReportDue",
      type: "date",
    },
  ],

  views: [
    {
      name: "projectTemplates:common.views.deadlines",
      description:
        "projectTemplates:content.grant-tracker.views.deadlinesDescription",
      filters: {
        root: { key: "group", operator: "notIn", values: ["cancelled"] },
      },
      display: { layout: "calendar", groupBy: null },
    },
    {
      name: "projectTemplates:common.views.pipeline",
      filters: {
        root: { key: "group", operator: "notIn", values: ["cancelled"] },
      },
      display: { layout: "board", groupBy: "status" },
    },
    {
      name: "projectTemplates:content.grant-tracker.views.fundingSheet",
      description:
        "projectTemplates:content.grant-tracker.views.fundingSheetDescription",
      display: { layout: "spreadsheet", groupBy: "status" },
      displayProperties: {
        labels: true,
        dueDate: true,
        customFields: ["funder", "amount-requested", "amount-awarded"],
      },
    },
    {
      name: "projectTemplates:content.grant-tracker.views.reportsDue",
      description:
        "projectTemplates:content.grant-tracker.views.reportsDueDescription",
      filters: {
        root: { key: "status", operator: "in", columns: ["awarded"] },
      },
      display: {
        layout: "list",
        groupBy: null,
        orderBy: {
          field: { customField: "next-report-due" },
          direction: "asc",
        },
      },
    },
  ],

  taskTemplates: [
    {
      name: "projectTemplates:content.grant-tracker.taskTemplates.application.name",
      titlePattern:
        "projectTemplates:content.grant-tracker.taskTemplates.application.titlePattern",
      description:
        "projectTemplates:content.grant-tracker.taskTemplates.application.description",
      priority: "high",
      subtasks: [
        "projectTemplates:content.grant-tracker.subtasks.confirmEligibility",
        "projectTemplates:content.grant-tracker.subtasks.readGuidelines",
        "projectTemplates:content.grant-tracker.subtasks.outline",
        "projectTemplates:content.grant-tracker.subtasks.budget",
        "projectTemplates:content.grant-tracker.subtasks.narrativeDraft",
        "projectTemplates:content.grant-tracker.subtasks.attachments",
        "projectTemplates:content.grant-tracker.subtasks.internalReview",
        "projectTemplates:content.grant-tracker.subtasks.submit",
      ],
    },
    {
      name: "projectTemplates:content.grant-tracker.taskTemplates.grantReport.name",
      titlePattern:
        "projectTemplates:content.grant-tracker.taskTemplates.grantReport.titlePattern",
      description:
        "projectTemplates:content.grant-tracker.taskTemplates.grantReport.description",
      column: "awarded",
      priority: "high",
    },
  ],

  automationRules: [
    {
      name: "projectTemplates:content.grant-tracker.rules.awarded",
      trigger: { type: "status_changed", to: ["awarded"] },
      actions: [
        {
          type: "create_subtask",
          title: "projectTemplates:content.grant-tracker.rules.thankYou",
        },
        {
          type: "create_subtask",
          title: "projectTemplates:content.grant-tracker.rules.reportDates",
        },
        {
          type: "notify",
          roles: ["lead"],
          message:
            "projectTemplates:content.grant-tracker.rules.awardedMessage",
        },
      ],
    },
    {
      name: "projectTemplates:content.grant-tracker.rules.declined",
      trigger: { type: "status_changed", to: ["declined"] },
      actions: [
        {
          type: "add_comment",
          template:
            "projectTemplates:content.grant-tracker.rules.declinedComment",
        },
      ],
    },
    {
      name: "projectTemplates:content.grant-tracker.rules.deadlinePassed",
      trigger: { type: "due_date_passed" },
      conditions: {
        op: "and",
        conditions: [
          {
            field: "status",
            op: "is",
            columns: ["prospect", "letter-of-inquiry", "drafting"],
          },
        ],
      },
      actions: [
        {
          type: "notify",
          roles: ["assignees"],
          message:
            "projectTemplates:content.grant-tracker.rules.deadlinePassedMessage",
        },
      ],
    },
  ],

  pages: [
    {
      key: "boilerplate",
      title: "projectTemplates:content.grant-tracker.pages.boilerplate.title",
      logo: { kind: "icon", value: "BookOpen" },
      sections: [
        {
          heading:
            "projectTemplates:content.grant-tracker.pages.boilerplate.mission",
          starter:
            "projectTemplates:content.grant-tracker.pages.boilerplate.missionStarter",
        },
        {
          heading:
            "projectTemplates:content.grant-tracker.pages.boilerplate.history",
          starter: "",
        },
        {
          heading:
            "projectTemplates:content.grant-tracker.pages.boilerplate.programs",
          starter: "-",
        },
        {
          heading:
            "projectTemplates:content.grant-tracker.pages.boilerplate.people",
          starter: "-",
        },
        {
          heading: "projectTemplates:common.pages.budget",
          starter:
            "projectTemplates:content.grant-tracker.pages.boilerplate.budgetStarter",
        },
        {
          heading:
            "projectTemplates:content.grant-tracker.pages.boilerplate.outcomes",
          starter: "-",
        },
      ],
    },
    {
      key: "funder-notes",
      title: "projectTemplates:content.grant-tracker.pages.funderNotes.title",
      logo: { kind: "icon", value: "Users" },
      sections: [
        {
          heading:
            "projectTemplates:content.grant-tracker.pages.funderNotes.priorities",
          starter:
            "projectTemplates:content.grant-tracker.pages.funderNotes.prioritiesStarter",
        },
        { heading: "projectTemplates:common.pages.whoToCall", starter: "-" },
        {
          heading:
            "projectTemplates:content.grant-tracker.pages.funderNotes.pastRequests",
          starter: "-",
        },
        {
          heading:
            "projectTemplates:content.grant-tracker.pages.funderNotes.feedback",
          starter: "-",
        },
      ],
    },
    {
      key: "deadline-rule",
      title: "projectTemplates:content.grant-tracker.pages.deadlineRule.title",
      logo: { kind: "icon", value: "Calendar" },
      sections: [
        {
          heading:
            "projectTemplates:content.grant-tracker.pages.deadlineRule.internalDraft",
          starter:
            "projectTemplates:content.grant-tracker.pages.deadlineRule.internalDraftStarter",
        },
        {
          heading:
            "projectTemplates:content.grant-tracker.pages.deadlineRule.finalReview",
          starter:
            "projectTemplates:content.grant-tracker.pages.deadlineRule.finalReviewStarter",
        },
      ],
    },
  ],

  sample: {
    tasks: [
      {
        key: "riverstone",
        title: "projectTemplates:content.grant-tracker.samples.riverstone",
        description:
          "projectTemplates:content.grant-tracker.samples.riverstoneDescription",
        column: "drafting",
        priority: "high",
        labels: ["foundation"],
        assignee: "creator",
        startInDays: -7,
        dueInDays: 21,
        customFields: {
          funder:
            "projectTemplates:content.grant-tracker.samples.riverstoneFunder",
          "amount-requested": "25000",
        },
      },
      {
        key: "county-arts",
        title: "projectTemplates:content.grant-tracker.samples.countyArts",
        column: "letter-of-inquiry",
        priority: "medium",
        labels: ["government"],
        dueInDays: 35,
        customFields: {
          funder:
            "projectTemplates:content.grant-tracker.samples.countyArtsFunder",
          "amount-requested": "40000",
        },
      },
      {
        key: "holloway",
        title: "projectTemplates:content.grant-tracker.samples.holloway",
        column: "prospect",
        priority: "low",
        labels: ["corporate"],
        dueInDays: 60,
        customFields: {
          funder:
            "projectTemplates:content.grant-tracker.samples.hollowayFunder",
          "amount-requested": "5000",
        },
      },
      {
        key: "linden",
        title: "projectTemplates:content.grant-tracker.samples.linden",
        description:
          "projectTemplates:content.grant-tracker.samples.lindenDescription",
        column: "awarded",
        priority: "high",
        labels: ["foundation", "renewal"],
        assignee: "creator",
        customFields: {
          funder: "projectTemplates:content.grant-tracker.samples.lindenFunder",
          "amount-requested": "30000",
          "amount-awarded": "30000",
        },
      },
      {
        key: "brookmere",
        title: "projectTemplates:content.grant-tracker.samples.brookmere",
        column: "submitted",
        priority: "medium",
        labels: ["foundation"],
        dueInDays: -5,
        customFields: {
          funder:
            "projectTemplates:content.grant-tracker.samples.brookmereFunder",
          "amount-requested": "12000",
        },
      },
      {
        key: "coastal",
        title: "projectTemplates:content.grant-tracker.samples.coastal",
        description:
          "projectTemplates:content.grant-tracker.samples.coastalDescription",
        column: "declined",
        priority: "low",
        labels: ["government"],
        dueInDays: -30,
        customFields: {
          funder:
            "projectTemplates:content.grant-tracker.samples.coastalFunder",
          "amount-requested": "60000",
        },
      },
    ],
  },
};

export default template;
