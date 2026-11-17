import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/it-asset-management.md

const template: ProjectTemplate = {
  id: "it-asset-management",
  version: 1,
  categories: ["it", "facilities", "operations", "service-management"],
  icon: "Boxes",
  name: "projectTemplates:catalog.it-asset-management.name",
  pitch: "projectTemplates:catalog.it-asset-management.pitch",
  description: "projectTemplates:catalog.it-asset-management.description",
  suggestedKey: "ASSET",

  project: {
    description:
      "projectTemplates:content.it-asset-management.projectDescription",
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
      key: "to-order",
      name: "projectTemplates:content.it-asset-management.statuses.toOrder",
      group: "backlog",
    },
    {
      key: "in-stock",
      name: "projectTemplates:content.it-asset-management.statuses.inStock",
      group: "unstarted",
    },
    {
      key: "in-use",
      name: "projectTemplates:content.it-asset-management.statuses.inUse",
      group: "started",
    },
    {
      key: "in-repair",
      name: "projectTemplates:content.it-asset-management.statuses.inRepair",
      group: "started",
    },
    {
      key: "retired",
      name: "projectTemplates:common.statuses.retired",
      group: "completed",
    },
    {
      key: "lost",
      name: "projectTemplates:common.statuses.lost",
      group: "cancelled",
    },
  ],

  labels: [
    {
      key: "hardware",
      name: "projectTemplates:content.it-asset-management.labels.hardware",
      color: "dark-gray",
    },
    {
      key: "software",
      name: "projectTemplates:common.labels.software",
      color: "purple",
    },
    {
      key: "renewal-due",
      name: "projectTemplates:content.it-asset-management.labels.renewalDue",
      color: "yellow",
    },
  ],

  customFields: [
    {
      key: "category",
      name: "projectTemplates:content.it-asset-management.fields.category",
      type: "dropdown",
      options: [
        {
          key: "laptop",
          label:
            "projectTemplates:content.it-asset-management.options.category.laptop",
        },
        { key: "desktop", label: "projectTemplates:common.options.desktop" },
        {
          key: "monitor",
          label:
            "projectTemplates:content.it-asset-management.options.category.monitor",
        },
        {
          key: "phone",
          label:
            "projectTemplates:content.it-asset-management.options.category.phone",
        },
        {
          key: "peripheral",
          label:
            "projectTemplates:content.it-asset-management.options.category.peripheral",
        },
        {
          key: "server-network",
          label:
            "projectTemplates:content.it-asset-management.options.category.serverNetwork",
        },
        {
          key: "licence",
          label:
            "projectTemplates:content.it-asset-management.options.category.licence",
        },
        {
          key: "subscription",
          label:
            "projectTemplates:content.it-asset-management.options.category.subscription",
        },
      ],
    },
    {
      key: "serial",
      name: "projectTemplates:content.it-asset-management.fields.serial",
      type: "text",
    },
    {
      key: "holder",
      name: "projectTemplates:content.it-asset-management.fields.holder",
      type: "text",
    },
    {
      key: "purchase-date",
      name: "projectTemplates:content.it-asset-management.fields.purchaseDate",
      type: "date",
    },
    {
      key: "cost",
      name: "projectTemplates:common.fields.cost",
      type: "number",
    },
  ],

  views: [
    {
      name: "projectTemplates:content.it-asset-management.views.inventory",
      description:
        "projectTemplates:content.it-asset-management.views.inventoryDescription",
      filters: {
        root: { key: "group", operator: "notIn", values: ["cancelled"] },
      },
      display: { layout: "spreadsheet", groupBy: { customField: "category" } },
      displayProperties: {
        dueDate: true,
        customFields: ["serial", "holder", "purchase-date", "cost"],
      },
    },
    {
      name: "projectTemplates:content.it-asset-management.views.readyToHandOut",
      filters: {
        root: { key: "status", operator: "in", columns: ["in-stock"] },
      },
      display: { layout: "list", groupBy: { customField: "category" } },
    },
    {
      name: "projectTemplates:content.it-asset-management.views.renewals",
      description:
        "projectTemplates:content.it-asset-management.views.renewalsDescription",
      filters: {
        root: {
          key: "group",
          operator: "notIn",
          values: ["completed", "cancelled"],
        },
      },
      display: { layout: "calendar", groupBy: null },
    },
    {
      name: "projectTemplates:content.it-asset-management.views.byHolder",
      filters: {
        root: { key: "status", operator: "in", columns: ["in-use"] },
      },
      display: { layout: "list", groupBy: { customField: "holder" } },
    },
  ],

  intakeForm: {
    title: "projectTemplates:content.it-asset-management.form.title",
    intro: "projectTemplates:content.it-asset-management.form.intro",
    descriptionField: "required",
    nameField: "required",
    emailField: "required",
    customFields: ["category"],
    confirmationMessage:
      "projectTemplates:content.it-asset-management.form.confirmation",
  },

  taskTemplates: [
    {
      name: "projectTemplates:content.it-asset-management.taskTemplates.newLaptop.name",
      titlePattern:
        "projectTemplates:content.it-asset-management.taskTemplates.newLaptop.titlePattern",
      description:
        "projectTemplates:content.it-asset-management.taskTemplates.newLaptop.description",
      priority: "medium",
      labels: ["hardware"],
    },
    {
      name: "projectTemplates:content.it-asset-management.taskTemplates.subscription.name",
      description:
        "projectTemplates:content.it-asset-management.taskTemplates.subscription.description",
      priority: "medium",
      labels: ["software"],
    },
    {
      name: "projectTemplates:content.it-asset-management.taskTemplates.retire.name",
      titlePattern:
        "projectTemplates:content.it-asset-management.taskTemplates.retire.titlePattern",
      description:
        "projectTemplates:content.it-asset-management.taskTemplates.retire.description",
      column: "in-use",
      priority: "low",
    },
  ],

  automationRules: [
    {
      name: "projectTemplates:content.it-asset-management.rules.renewal",
      trigger: { type: "due_date_passed" },
      conditions: {
        op: "and",
        conditions: [
          { field: "status", op: "is_not", columns: ["retired", "lost"] },
        ],
      },
      actions: [
        { type: "add_label", label: "renewal-due" },
        {
          type: "notify",
          roles: ["assignees"],
          message:
            "projectTemplates:content.it-asset-management.rules.renewalMessage",
        },
      ],
    },
    {
      name: "projectTemplates:content.it-asset-management.rules.repair",
      trigger: { type: "status_changed", to: ["in-repair"] },
      actions: [
        {
          type: "add_comment",
          template:
            "projectTemplates:content.it-asset-management.rules.repairComment",
        },
      ],
    },
    {
      name: "projectTemplates:content.it-asset-management.rules.retire",
      trigger: { type: "status_changed", to: ["retired"] },
      conditions: {
        op: "and",
        conditions: [{ field: "labels", op: "contains", labels: ["hardware"] }],
      },
      actions: [
        {
          type: "create_subtask",
          title:
            "projectTemplates:content.it-asset-management.rules.retireSubtask",
        },
      ],
    },
  ],

  pages: [
    {
      key: "asset-policy",
      title:
        "projectTemplates:content.it-asset-management.pages.assetPolicy.title",
      logo: { kind: "icon", value: "ScrollText" },
      sections: [
        {
          heading:
            "projectTemplates:content.it-asset-management.pages.assetPolicy.requests",
          starter:
            "projectTemplates:content.it-asset-management.pages.assetPolicy.requestsStarter",
        },
        {
          heading:
            "projectTemplates:content.it-asset-management.pages.assetPolicy.kits",
          starter:
            "projectTemplates:content.it-asset-management.pages.assetPolicy.kitsStarter",
        },
        {
          heading:
            "projectTemplates:content.it-asset-management.pages.assetPolicy.replacement",
          starter:
            "projectTemplates:content.it-asset-management.pages.assetPolicy.replacementStarter",
        },
        {
          heading:
            "projectTemplates:content.it-asset-management.pages.assetPolicy.leavers",
          starter:
            "projectTemplates:content.it-asset-management.pages.assetPolicy.leaversStarter",
        },
        {
          heading:
            "projectTemplates:content.it-asset-management.pages.assetPolicy.lost",
          starter:
            "projectTemplates:content.it-asset-management.pages.assetPolicy.lostStarter",
        },
        {
          heading:
            "projectTemplates:content.it-asset-management.pages.assetPolicy.disposal",
          starter:
            "projectTemplates:content.it-asset-management.pages.assetPolicy.disposalStarter",
        },
      ],
    },
    {
      key: "software-register",
      title:
        "projectTemplates:content.it-asset-management.pages.softwareRegister.title",
      logo: { kind: "icon", value: "BookOpen" },
      sections: [
        {
          heading:
            "projectTemplates:content.it-asset-management.pages.softwareRegister.recording",
          starter:
            "projectTemplates:content.it-asset-management.pages.softwareRegister.recordingStarter",
        },
        {
          heading:
            "projectTemplates:content.it-asset-management.pages.softwareRegister.keys",
          starter:
            "projectTemplates:content.it-asset-management.pages.softwareRegister.keysStarter",
        },
        {
          heading:
            "projectTemplates:content.it-asset-management.pages.softwareRegister.seatReview",
          starter:
            "projectTemplates:content.it-asset-management.pages.softwareRegister.seatReviewStarter",
        },
      ],
    },
  ],

  sample: {
    tasks: [
      {
        key: "support-laptop",
        title:
          "projectTemplates:content.it-asset-management.samples.supportLaptop",
        description:
          "projectTemplates:content.it-asset-management.samples.supportLaptopDescription",
        column: "in-use",
        priority: "medium",
        labels: ["hardware"],
        customFields: {
          category: "laptop",
          serial:
            "projectTemplates:content.it-asset-management.samples.serial48213",
          holder:
            "projectTemplates:content.it-asset-management.samples.supportTeam",
          cost: "1450",
        },
      },
      {
        key: "monitor",
        title: "projectTemplates:content.it-asset-management.samples.monitor",
        description:
          "projectTemplates:content.it-asset-management.samples.monitorDescription",
        column: "in-repair",
        priority: "low",
        labels: ["hardware"],
        customFields: {
          category: "monitor",
          serial:
            "projectTemplates:content.it-asset-management.samples.serial11907",
          holder:
            "projectTemplates:content.it-asset-management.samples.financeDesk",
        },
      },
      {
        key: "design-subscription",
        title:
          "projectTemplates:content.it-asset-management.samples.designSubscription",
        description:
          "projectTemplates:content.it-asset-management.samples.designSubscriptionDescription",
        column: "in-use",
        priority: "medium",
        labels: ["software"],
        assignee: "creator",
        dueInDays: 21,
        customFields: {
          category: "subscription",
          holder:
            "projectTemplates:content.it-asset-management.samples.designTeam",
          cost: "2160",
        },
      },
      {
        key: "spare-laptop",
        title:
          "projectTemplates:content.it-asset-management.samples.spareLaptop",
        column: "in-stock",
        priority: "no-priority",
        labels: ["hardware"],
        customFields: {
          category: "laptop",
          serial:
            "projectTemplates:content.it-asset-management.samples.serial30455",
        },
      },
      {
        key: "conference-phone",
        title:
          "projectTemplates:content.it-asset-management.samples.conferencePhone",
        column: "retired",
        priority: "no-priority",
        labels: ["hardware"],
        customFields: {
          category: "phone",
          serial:
            "projectTemplates:content.it-asset-management.samples.serial77310",
        },
      },
      {
        key: "docking-stations",
        title:
          "projectTemplates:content.it-asset-management.samples.dockingStations",
        column: "to-order",
        priority: "medium",
        labels: ["hardware"],
        customFields: { category: "peripheral" },
      },
    ],
  },
};

export default template;
