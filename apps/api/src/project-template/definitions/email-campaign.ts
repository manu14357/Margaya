import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/email-campaign.md

const template: ProjectTemplate = {
  id: "email-campaign",
  version: 1,
  categories: ["marketing", "work-management"],
  icon: "Share2",
  name: "projectTemplates:catalog.email-campaign.name",
  pitch: "projectTemplates:catalog.email-campaign.pitch",
  description: "projectTemplates:catalog.email-campaign.description",
  suggestedKey: "EML",

  project: {
    description: "projectTemplates:content.email-campaign.projectDescription",
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
      key: "brief",
      name: "projectTemplates:content.email-campaign.statuses.brief",
      group: "unstarted",
    },
    {
      key: "copy",
      name: "projectTemplates:content.email-campaign.statuses.copy",
      group: "started",
    },
    {
      key: "design",
      name: "projectTemplates:common.statuses.design",
      group: "started",
    },
    {
      key: "qa",
      name: "projectTemplates:content.email-campaign.statuses.qa",
      group: "started",
    },
    {
      key: "scheduled",
      name: "projectTemplates:common.statuses.scheduled",
      group: "started",
    },
    {
      key: "sent",
      name: "projectTemplates:content.email-campaign.statuses.sent",
      group: "started",
    },
    {
      key: "results-logged",
      name: "projectTemplates:content.email-campaign.statuses.resultsLogged",
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
      key: "newsletter",
      name: "projectTemplates:common.labels.newsletter",
      color: "teal",
    },
    {
      key: "promotion",
      name: "projectTemplates:common.labels.promotion",
      color: "yellow",
    },
    {
      key: "product-news",
      name: "projectTemplates:content.email-campaign.labels.productNews",
      color: "purple",
    },
    {
      key: "lifecycle",
      name: "projectTemplates:content.email-campaign.labels.lifecycle",
      color: "green",
    },
  ],

  customFields: [
    {
      key: "segment",
      name: "projectTemplates:content.email-campaign.fields.segment",
      type: "text",
    },
    {
      key: "subject-line",
      name: "projectTemplates:content.email-campaign.fields.subjectLine",
      type: "text",
    },
    {
      key: "open-rate",
      name: "projectTemplates:content.email-campaign.fields.openRate",
      type: "number",
    },
    {
      key: "click-rate",
      name: "projectTemplates:content.email-campaign.fields.clickRate",
      type: "number",
    },
  ],

  views: [
    {
      name: "projectTemplates:content.email-campaign.views.sendCalendar",
      description:
        "projectTemplates:content.email-campaign.views.sendCalendarDescription",
      filters: {
        root: { key: "group", operator: "notIn", values: ["cancelled"] },
      },
      display: { layout: "calendar", groupBy: null },
    },
    {
      name: "projectTemplates:content.email-campaign.views.qaQueue",
      filters: {
        root: { key: "status", operator: "in", columns: ["qa"] },
      },
      display: {
        layout: "list",
        groupBy: null,
        orderBy: { field: "dueDate", direction: "asc" },
      },
    },
    {
      name: "projectTemplates:common.views.results",
      filters: {
        root: { key: "status", operator: "in", columns: ["results-logged"] },
        archived: "include",
      },
      display: {
        layout: "spreadsheet",
        groupBy: null,
        orderBy: { field: "dueDate", direction: "desc" },
      },
      displayProperties: {
        labels: true,
        dueDate: true,
        customFields: ["segment", "subject-line", "open-rate", "click-rate"],
      },
    },
  ],

  taskTemplates: [
    {
      name: "projectTemplates:content.email-campaign.taskTemplates.email.name",
      description:
        "projectTemplates:content.email-campaign.taskTemplates.email.description",
      priority: "medium",
      subtasks: [
        "projectTemplates:content.email-campaign.subtasks.briefAgreed",
        "projectTemplates:content.email-campaign.subtasks.copyFinal",
        "projectTemplates:content.email-campaign.subtasks.designBuilt",
        "projectTemplates:content.email-campaign.subtasks.qaPassed",
        "projectTemplates:content.email-campaign.subtasks.scheduled",
      ],
    },
  ],

  automationRules: [
    {
      name: "projectTemplates:content.email-campaign.rules.sentFollowUp",
      trigger: { type: "status_changed", to: ["sent"] },
      actions: [
        { type: "set_due_date", offsetDays: 3 },
        {
          type: "add_comment",
          template: "projectTemplates:content.email-campaign.rules.sentComment",
        },
      ],
    },
    {
      name: "projectTemplates:content.email-campaign.rules.qaNotify",
      trigger: { type: "status_changed", to: ["qa"] },
      actions: [
        {
          type: "notify",
          roles: ["lead"],
          message: "projectTemplates:content.email-campaign.rules.qaMessage",
        },
      ],
    },
  ],

  pages: [
    {
      key: "email-brief",
      title: "projectTemplates:content.email-campaign.pages.brief.title",
      logo: { kind: "icon", value: "FileText" },
      sections: [
        {
          heading: "projectTemplates:common.pages.goal",
          starter:
            "projectTemplates:content.email-campaign.pages.brief.goalStarter",
        },
        {
          heading: "projectTemplates:content.email-campaign.fields.segment",
          starter:
            "projectTemplates:content.email-campaign.pages.brief.segmentStarter",
        },
        {
          heading: "projectTemplates:common.pages.keyMessage",
          starter:
            "projectTemplates:content.email-campaign.pages.brief.keyMessageStarter",
        },
        {
          heading:
            "projectTemplates:content.email-campaign.pages.brief.callToAction",
          starter:
            "projectTemplates:content.email-campaign.pages.brief.callToActionStarter",
        },
        {
          heading:
            "projectTemplates:content.email-campaign.pages.brief.sendDate",
          starter: "",
        },
        {
          heading: "projectTemplates:common.pages.whoApproves",
          starter: "",
        },
      ],
    },
    {
      key: "qa-checklist",
      title: "projectTemplates:content.email-campaign.pages.qa.title",
      logo: { kind: "icon", value: "List" },
      sections: [
        {
          heading: "projectTemplates:content.email-campaign.pages.qa.links",
          starter:
            "projectTemplates:content.email-campaign.pages.qa.linksStarter",
        },
        {
          heading: "projectTemplates:content.email-campaign.pages.qa.personal",
          starter:
            "projectTemplates:content.email-campaign.pages.qa.personalStarter",
        },
        {
          heading: "projectTemplates:content.email-campaign.pages.qa.images",
          starter:
            "projectTemplates:content.email-campaign.pages.qa.imagesStarter",
        },
        {
          heading: "projectTemplates:content.email-campaign.pages.qa.footer",
          starter:
            "projectTemplates:content.email-campaign.pages.qa.footerStarter",
        },
        {
          heading: "projectTemplates:content.email-campaign.pages.qa.testSend",
          starter:
            "projectTemplates:content.email-campaign.pages.qa.testSendStarter",
        },
      ],
    },
    {
      key: "style-guide",
      title: "projectTemplates:content.email-campaign.pages.style.title",
      logo: { kind: "icon", value: "Palette" },
      sections: [
        {
          heading: "projectTemplates:content.email-campaign.pages.style.sender",
          starter:
            "projectTemplates:content.email-campaign.pages.style.senderStarter",
        },
        {
          heading: "projectTemplates:content.email-campaign.pages.style.tone",
          starter:
            "projectTemplates:content.email-campaign.pages.style.toneStarter",
        },
        {
          heading:
            "projectTemplates:content.email-campaign.pages.style.subjects",
          starter:
            "projectTemplates:content.email-campaign.pages.style.subjectsStarter",
        },
        {
          heading: "projectTemplates:content.email-campaign.pages.style.images",
          starter:
            "projectTemplates:content.email-campaign.pages.style.imagesStarter",
        },
        {
          heading: "projectTemplates:content.email-campaign.pages.style.footer",
          starter:
            "projectTemplates:content.email-campaign.pages.style.footerStarter",
        },
      ],
    },
  ],

  sample: {
    tasks: [
      {
        key: "march-newsletter",
        title:
          "projectTemplates:content.email-campaign.samples.marchNewsletter",
        description:
          "projectTemplates:content.email-campaign.samples.marchNewsletterDescription",
        column: "results-logged",
        priority: "medium",
        labels: ["newsletter"],
        dueInDays: -18,
        customFields: {
          segment:
            "projectTemplates:content.email-campaign.samples.allSubscribers",
          "open-rate": "41",
          "click-rate": "6",
        },
      },
      {
        key: "spring-discount",
        title: "projectTemplates:content.email-campaign.samples.springDiscount",
        description:
          "projectTemplates:content.email-campaign.samples.springDiscountDescription",
        column: "qa",
        priority: "high",
        labels: ["promotion"],
        assignee: "creator",
        dueInDays: 4,
        customFields: {
          segment:
            "projectTemplates:content.email-campaign.samples.olderBikesSegment",
        },
      },
      {
        key: "repair-booking",
        title: "projectTemplates:content.email-campaign.samples.repairBooking",
        column: "copy",
        priority: "medium",
        labels: ["product-news"],
        dueInDays: 12,
      },
      {
        key: "welcome-two",
        title: "projectTemplates:content.email-campaign.samples.welcomeTwo",
        column: "design",
        priority: "medium",
        labels: ["lifecycle"],
        dueInDays: 9,
      },
      {
        key: "weekend-sale",
        title: "projectTemplates:content.email-campaign.samples.weekendSale",
        column: "scheduled",
        priority: "high",
        labels: ["promotion"],
        dueInDays: 2,
        customFields: {
          "subject-line":
            "projectTemplates:content.email-campaign.samples.weekendSaleSubject",
        },
      },
      {
        key: "april-newsletter",
        title:
          "projectTemplates:content.email-campaign.samples.aprilNewsletter",
        column: "brief",
        priority: "low",
        labels: ["newsletter"],
        dueInDays: 20,
      },
    ],
  },
};

export default template;
