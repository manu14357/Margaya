import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/recruitment.md

const template: ProjectTemplate = {
  id: "recruitment",
  version: 1,
  categories: ["human-resources", "work-management"],
  icon: "Briefcase",
  name: "projectTemplates:catalog.recruitment.name",
  pitch: "projectTemplates:catalog.recruitment.pitch",
  description: "projectTemplates:catalog.recruitment.description",
  suggestedKey: "HIRE",
  // Candidate cards are personal data: only the hiring team (plus workspace
  // owners and admins) should see them.
  suggestedVisibility: "restricted",

  project: {
    description: "projectTemplates:content.recruitment.projectDescription",
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
      key: "applied",
      name: "projectTemplates:content.recruitment.statuses.applied",
      group: "unstarted",
    },
    {
      key: "screening",
      name: "projectTemplates:content.recruitment.statuses.screening",
      group: "started",
    },
    {
      key: "interviewing",
      name: "projectTemplates:content.recruitment.statuses.interviewing",
      group: "started",
    },
    {
      key: "offer",
      name: "projectTemplates:content.recruitment.statuses.offer",
      group: "started",
    },
    {
      key: "hired",
      name: "projectTemplates:content.recruitment.statuses.hired",
      group: "completed",
    },
    {
      key: "not-moving-forward",
      name: "projectTemplates:content.recruitment.statuses.notMovingForward",
      group: "cancelled",
    },
  ],

  labels: [
    {
      key: "referral",
      name: "projectTemplates:content.recruitment.labels.referral",
      color: "green",
    },
    {
      key: "internal",
      name: "projectTemplates:content.recruitment.labels.internal",
      color: "teal",
    },
    {
      key: "needs-decision",
      name: "projectTemplates:content.recruitment.labels.needsDecision",
      color: "yellow",
    },
  ],

  customFields: [
    {
      key: "role",
      name: "projectTemplates:content.recruitment.fields.role",
      type: "dropdown",
      options: [
        {
          key: "support-specialist",
          label:
            "projectTemplates:content.recruitment.options.role.supportSpecialist",
        },
        {
          key: "account-manager",
          label:
            "projectTemplates:content.recruitment.options.role.accountManager",
        },
        {
          key: "operations-coordinator",
          label:
            "projectTemplates:content.recruitment.options.role.operationsCoordinator",
        },
      ],
    },
    {
      key: "source",
      name: "projectTemplates:common.fields.source",
      type: "dropdown",
      options: [
        {
          key: "careers-page",
          label:
            "projectTemplates:content.recruitment.options.source.careersPage",
        },
        { key: "referral", label: "projectTemplates:common.options.referral" },
        {
          key: "job-board",
          label: "projectTemplates:content.recruitment.options.source.jobBoard",
        },
        {
          key: "agency",
          label: "projectTemplates:content.recruitment.options.source.agency",
        },
        { key: "other", label: "projectTemplates:common.options.other" },
      ],
    },
    {
      key: "scorecards-in",
      name: "projectTemplates:content.recruitment.fields.scorecardsIn",
      type: "boolean",
      defaultValue: "false",
    },
  ],

  views: [
    {
      name: "projectTemplates:content.recruitment.views.byRole",
      filters: {
        root: {
          key: "group",
          operator: "notIn",
          values: ["completed", "cancelled"],
        },
      },
      display: {
        layout: "list",
        groupBy: { customField: "role" },
        subGroupBy: "status",
      },
    },
    {
      name: "projectTemplates:content.recruitment.views.interviewsThisWeek",
      filters: {
        root: {
          op: "and",
          children: [
            { key: "status", operator: "in", columns: ["interviewing"] },
            { key: "dueDate", operator: "in", values: ["thisWeek"] },
          ],
        },
      },
      display: {
        layout: "list",
        groupBy: null,
        orderBy: { field: "dueDate", direction: "asc" },
      },
    },
    {
      name: "projectTemplates:content.recruitment.views.waitingForDecision",
      filters: {
        root: { key: "label", operator: "in", labels: ["needs-decision"] },
      },
      display: {
        layout: "list",
        groupBy: null,
        orderBy: { field: "updatedAt", direction: "asc" },
      },
    },
  ],

  taskTemplates: [
    {
      name: "projectTemplates:content.recruitment.taskTemplates.candidate.name",
      description:
        "projectTemplates:content.recruitment.taskTemplates.candidate.description",
      priority: "medium",
    },
    {
      name: "projectTemplates:content.recruitment.taskTemplates.offer.name",
      titlePattern:
        "projectTemplates:content.recruitment.taskTemplates.offer.titlePattern",
      description:
        "projectTemplates:content.recruitment.taskTemplates.offer.description",
      column: "offer",
      priority: "high",
    },
  ],

  automationRules: [
    {
      name: "projectTemplates:content.recruitment.rules.collectScorecards",
      trigger: { type: "status_changed", to: ["interviewing"] },
      actions: [
        {
          type: "create_subtask",
          title:
            "projectTemplates:content.recruitment.rules.collectScorecardsTask",
        },
      ],
    },
    {
      name: "projectTemplates:content.recruitment.rules.respectfulDecline",
      trigger: { type: "status_changed", to: ["not-moving-forward"] },
      actions: [
        { type: "set_due_date", offsetDays: 2 },
        {
          type: "add_comment",
          template:
            "projectTemplates:content.recruitment.rules.respectfulDeclineComment",
        },
      ],
    },
    {
      name: "projectTemplates:content.recruitment.rules.decisionNeeded",
      trigger: { type: "label_added", labels: ["needs-decision"] },
      actions: [
        {
          type: "notify",
          roles: ["lead"],
          message:
            "projectTemplates:content.recruitment.rules.decisionNeededMessage",
        },
      ],
    },
  ],

  pages: [
    {
      key: "role-brief",
      title: "projectTemplates:content.recruitment.pages.roleBrief.title",
      logo: { kind: "icon", value: "Target" },
      sections: [
        {
          heading: "projectTemplates:common.pages.purpose",
          starter:
            "projectTemplates:content.recruitment.pages.roleBrief.purposeStarter",
        },
        {
          heading:
            "projectTemplates:content.recruitment.pages.roleBrief.mustHave",
          starter: "-",
        },
        {
          heading:
            "projectTemplates:content.recruitment.pages.roleBrief.niceToHave",
          starter: "-",
        },
        {
          heading:
            "projectTemplates:content.recruitment.pages.roleBrief.competencies",
          starter:
            "projectTemplates:content.recruitment.pages.roleBrief.competenciesStarter",
        },
        {
          heading:
            "projectTemplates:content.recruitment.pages.roleBrief.interviewPlan",
          starter: "1.",
        },
        {
          heading:
            "projectTemplates:content.recruitment.pages.roleBrief.coreQuestions",
          starter:
            "projectTemplates:content.recruitment.pages.roleBrief.coreQuestionsStarter",
        },
        {
          heading:
            "projectTemplates:content.recruitment.pages.roleBrief.scoringScale",
          starter:
            "projectTemplates:content.recruitment.pages.roleBrief.scoringScaleStarter",
        },
      ],
    },
    {
      key: "privacy-rules",
      title: "projectTemplates:content.recruitment.pages.privacy.title",
      logo: { kind: "icon", value: "Shield" },
      sections: [
        {
          heading:
            "projectTemplates:content.recruitment.pages.privacy.whoCanSee",
          starter:
            "projectTemplates:content.recruitment.pages.privacy.whoCanSeeStarter",
        },
        {
          heading:
            "projectTemplates:content.recruitment.pages.privacy.referenceCodes",
          starter:
            "projectTemplates:content.recruitment.pages.privacy.referenceCodesStarter",
        },
        {
          heading:
            "projectTemplates:content.recruitment.pages.privacy.neverRecord",
          starter:
            "projectTemplates:content.recruitment.pages.privacy.neverRecordStarter",
        },
        {
          heading:
            "projectTemplates:content.recruitment.pages.privacy.retention",
          starter:
            "projectTemplates:content.recruitment.pages.privacy.retentionStarter",
        },
      ],
    },
  ],

  sample: {
    tasks: [
      {
        key: "c-1042",
        title: "projectTemplates:content.recruitment.samples.c1042",
        description:
          "projectTemplates:content.recruitment.samples.c1042Description",
        column: "interviewing",
        priority: "high",
        assignee: "creator",
        dueInDays: 2,
        customFields: { role: "support-specialist", source: "careers-page" },
      },
      {
        key: "c-1047",
        title: "projectTemplates:content.recruitment.samples.c1047",
        column: "screening",
        priority: "medium",
        customFields: { role: "support-specialist", source: "job-board" },
      },
      {
        key: "c-1051",
        title: "projectTemplates:content.recruitment.samples.c1051",
        description:
          "projectTemplates:content.recruitment.samples.c1051Description",
        column: "offer",
        priority: "high",
        labels: ["referral"],
        assignee: "creator",
        dueInDays: 3,
        customFields: {
          role: "account-manager",
          source: "referral",
          "scorecards-in": "true",
        },
      },
      {
        key: "c-1053",
        title: "projectTemplates:content.recruitment.samples.c1053",
        column: "applied",
        priority: "medium",
        customFields: {
          role: "operations-coordinator",
          source: "careers-page",
        },
      },
      {
        key: "c-1038",
        title: "projectTemplates:content.recruitment.samples.c1038",
        description:
          "projectTemplates:content.recruitment.samples.c1038Description",
        column: "not-moving-forward",
        priority: "low",
        dueInDays: 1,
        customFields: { role: "account-manager", source: "agency" },
      },
      {
        key: "c-1029",
        title: "projectTemplates:content.recruitment.samples.c1029",
        column: "hired",
        priority: "medium",
        labels: ["internal"],
        customFields: {
          role: "operations-coordinator",
          "scorecards-in": "true",
        },
      },
    ],
  },
};

export default template;
