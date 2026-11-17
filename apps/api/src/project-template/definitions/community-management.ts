import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/community-management.md

const T = "projectTemplates:content.community-management" as const;

const template: ProjectTemplate = {
  id: "community-management",
  version: 1,
  categories: ["nonprofit", "work-management"],
  icon: "Users",
  name: "projectTemplates:catalog.community-management.name",
  pitch: "projectTemplates:catalog.community-management.pitch",
  description: "projectTemplates:catalog.community-management.description",
  suggestedKey: "COM",

  project: {
    description: `${T}.projectDescription`,
    features: {
      cycles: false,
      modules: false,
      views: true,
      pages: true,
      whiteboards: false,
      intake: true,
      estimates: false,
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
      key: "waiting-on-member",
      name: `${T}.statuses.waitingOnMember`,
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
    { key: "moderation", name: `${T}.labels.moderation`, color: "red" },
    { key: "onboarding", name: `${T}.labels.onboarding`, color: "green" },
    { key: "event", name: `${T}.labels.event`, color: "purple" },
    { key: "feedback", name: `${T}.labels.feedback`, color: "yellow" },
    { key: "ambassadors", name: `${T}.labels.ambassadors`, color: "orange" },
  ],

  customFields: [
    {
      key: "request-type",
      name: "projectTemplates:common.fields.requestType",
      type: "dropdown",
      options: [
        { key: "feedback", label: "projectTemplates:common.options.feedback" },
        { key: "event-idea", label: `${T}.options.requestType.eventIdea` },
        { key: "problem", label: `${T}.options.requestType.problem` },
        {
          key: "ambassador",
          label: `${T}.options.requestType.ambassador`,
        },
      ],
    },
    {
      key: "channel",
      name: `${T}.fields.channel`,
      type: "dropdown",
      options: [
        { key: "forum", label: `${T}.options.channel.forum` },
        { key: "chat", label: `${T}.options.channel.chat` },
        { key: "social", label: `${T}.options.channel.social` },
        { key: "email", label: "projectTemplates:common.options.email" },
        { key: "in-person", label: `${T}.options.channel.inPerson` },
      ],
    },
    { key: "member", name: `${T}.fields.member`, type: "text" },
  ],

  views: [
    {
      name: "projectTemplates:common.views.board",
      filters: {
        root: { key: "group", operator: "notIn", values: ["cancelled"] },
      },
      display: {
        layout: "board",
        groupBy: "status",
        orderBy: { field: "priority", direction: "desc" },
      },
    },
    {
      name: `${T}.views.moderationQueue`,
      filters: {
        root: {
          op: "and",
          children: [
            { key: "label", operator: "in", labels: ["moderation"] },
            {
              key: "group",
              operator: "notIn",
              values: ["completed", "cancelled"],
            },
          ],
        },
      },
      display: {
        layout: "list",
        groupBy: null,
        orderBy: { field: "priority", direction: "desc" },
      },
    },
    {
      name: `${T}.views.eventsCalendar`,
      filters: {
        root: {
          op: "and",
          children: [
            { key: "label", operator: "in", labels: ["event"] },
            { key: "group", operator: "notIn", values: ["cancelled"] },
          ],
        },
      },
      display: { layout: "calendar", groupBy: null },
    },
    {
      name: `${T}.views.feedbackThemes`,
      filters: {
        root: {
          key: "customField",
          field: "request-type",
          operator: "in",
          options: ["feedback"],
        },
      },
      display: {
        layout: "list",
        groupBy: "label",
        orderBy: { field: "createdAt", direction: "desc" },
      },
    },
  ],

  intakeForm: {
    title: `${T}.form.title`,
    intro: `${T}.form.intro`,
    descriptionField: "required",
    emailField: "required",
    nameField: "optional",
    customFields: ["request-type", "channel"],
    confirmationMessage: `${T}.form.confirmation`,
  },

  taskTemplates: [
    {
      name: `${T}.taskTemplates.healthCheck.name`,
      titlePattern: `${T}.taskTemplates.healthCheck.titlePattern`,
      description: `${T}.taskTemplates.healthCheck.description`,
      priority: "medium",
    },
    {
      name: `${T}.taskTemplates.event.name`,
      titlePattern: `${T}.taskTemplates.event.titlePattern`,
      description: `${T}.taskTemplates.event.description`,
      priority: "medium",
      labels: ["event"],
    },
    {
      name: `${T}.taskTemplates.ambassador.name`,
      titlePattern: `${T}.taskTemplates.ambassador.titlePattern`,
      description: `${T}.taskTemplates.ambassador.description`,
      priority: "low",
      labels: ["ambassadors"],
    },
  ],

  automationRules: [
    {
      name: `${T}.rules.replyToMember`,
      trigger: { type: "task_created", fromIntake: true },
      actions: [
        { type: "add_comment", template: `${T}.rules.replyToMemberComment` },
      ],
    },
    {
      name: `${T}.rules.moderationFirst`,
      trigger: { type: "label_added", labels: ["moderation"] },
      actions: [
        { type: "set_priority", priority: "urgent" },
        {
          type: "notify",
          roles: ["lead"],
          message: `${T}.rules.moderationMessage`,
        },
      ],
    },
    {
      name: `${T}.rules.waitingFollowUp`,
      trigger: { type: "status_changed", to: ["waiting-on-member"] },
      actions: [{ type: "set_due_date", offsetDays: 5 }],
    },
  ],

  pages: [
    {
      key: "guidelines",
      title: `${T}.pages.guidelines.title`,
      logo: { kind: "icon", value: "ScrollText" },
      sections: [
        {
          heading: `${T}.pages.guidelines.expect`,
          starter: `${T}.pages.guidelines.expectStarter`,
        },
        {
          heading: `${T}.pages.guidelines.notAllowed`,
          starter: `${T}.pages.guidelines.notAllowedStarter`,
        },
        {
          heading: `${T}.pages.guidelines.report`,
          starter: `${T}.pages.guidelines.reportStarter`,
        },
      ],
    },
    {
      key: "moderation-playbook",
      title: `${T}.pages.playbook.title`,
      logo: { kind: "icon", value: "Shield" },
      sections: [
        {
          heading: `${T}.pages.playbook.levels`,
          starter: `${T}.pages.playbook.levelsStarter`,
        },
        {
          heading: `${T}.pages.playbook.whoDecides`,
          starter: `${T}.pages.playbook.whoDecidesStarter`,
        },
        {
          heading: `${T}.pages.playbook.recording`,
          starter: `${T}.pages.playbook.recordingStarter`,
        },
        {
          heading: "projectTemplates:common.pages.whenToEscalate",
          starter: `${T}.pages.playbook.escalateStarter`,
        },
      ],
    },
    {
      key: "welcome-kit",
      title: `${T}.pages.welcome.title`,
      logo: { kind: "icon", value: "Heart" },
      sections: [
        {
          heading: `${T}.pages.welcome.firstSteps`,
          starter: `${T}.pages.welcome.firstStepsStarter`,
        },
        {
          heading: `${T}.pages.welcome.help`,
          starter: `${T}.pages.welcome.helpStarter`,
        },
        { heading: `${T}.pages.welcome.events`, starter: "-" },
      ],
    },
  ],

  sample: {
    tasks: [
      {
        key: "spam",
        title: `${T}.samples.spam`,
        description: `${T}.samples.spamDescription`,
        column: "in-progress",
        priority: "urgent",
        labels: ["moderation"],
        assignee: "creator",
        dueInDays: 0,
        customFields: { channel: "forum" },
      },
      {
        key: "welcome",
        title: `${T}.samples.welcome`,
        column: "todo",
        priority: "medium",
        labels: ["onboarding"],
        dueInDays: 7,
        customFields: { channel: "email" },
      },
      {
        key: "workshop",
        title: `${T}.samples.workshop`,
        description: `${T}.samples.workshopDescription`,
        column: "todo",
        priority: "medium",
        labels: ["event"],
        startInDays: 21,
        dueInDays: 21,
        customFields: { "request-type": "event-idea", channel: "chat" },
      },
      {
        key: "search",
        title: `${T}.samples.search`,
        description: `${T}.samples.searchDescription`,
        column: "waiting-on-member",
        priority: "low",
        labels: ["feedback"],
        dueInDays: 5,
        customFields: {
          "request-type": "feedback",
          channel: "forum",
          member: `${T}.samples.searchMember`,
        },
      },
      {
        key: "ambassador",
        title: `${T}.samples.ambassador`,
        column: "in-progress",
        priority: "low",
        labels: ["ambassadors"],
        customFields: { "request-type": "ambassador" },
      },
      {
        key: "health-check",
        title: `${T}.samples.healthCheck`,
        column: "done",
        priority: "medium",
      },
    ],
  },
};

export default template;
