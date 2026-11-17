import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/facilities-service-desk.md

const OPEN = ["unstarted", "started"] as const;

const template: ProjectTemplate = {
  id: "facilities-service-desk",
  version: 1,
  categories: ["service-management", "facilities"],
  icon: "Building2",
  name: "projectTemplates:catalog.facilities-service-desk.name",
  pitch: "projectTemplates:catalog.facilities-service-desk.pitch",
  description: "projectTemplates:catalog.facilities-service-desk.description",
  suggestedKey: "FAC",

  project: {
    description:
      "projectTemplates:content.facilities-service-desk.projectDescription",
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
      key: "new",
      name: "projectTemplates:common.statuses.new",
      group: "unstarted",
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
      key: "waiting",
      name: "projectTemplates:content.facilities-service-desk.statuses.waitingOnPartsOrContractor",
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
    {
      key: "contractor",
      name: "projectTemplates:content.facilities-service-desk.labels.contractor",
      color: "yellow",
    },
    {
      key: "safety",
      name: "projectTemplates:common.labels.safety",
      color: "red",
    },
    {
      key: "recurring",
      name: "projectTemplates:common.labels.recurring",
      color: "dark-gray",
    },
  ],

  customFields: [
    {
      key: "request-type",
      name: "projectTemplates:common.fields.requestType",
      type: "dropdown",
      options: [
        {
          key: "repair",
          label:
            "projectTemplates:content.facilities-service-desk.options.requestType.repair",
        },
        {
          key: "cleaning",
          label:
            "projectTemplates:content.facilities-service-desk.options.requestType.cleaning",
        },
        {
          key: "move",
          label:
            "projectTemplates:content.facilities-service-desk.options.requestType.move",
        },
        {
          key: "setup",
          label:
            "projectTemplates:content.facilities-service-desk.options.requestType.setup",
        },
        {
          key: "access",
          label:
            "projectTemplates:content.facilities-service-desk.options.requestType.access",
        },
        {
          key: "safety-hazard",
          label:
            "projectTemplates:content.facilities-service-desk.options.requestType.safetyHazard",
        },
        { key: "other", label: "projectTemplates:common.options.other" },
      ],
      defaultOption: "other",
    },
    {
      // The plan asks for "required", but a required field needs a default
      // value and no default location makes sense; the form asks for it.
      key: "location",
      name: "projectTemplates:common.fields.location",
      type: "text",
    },
    {
      key: "how-urgent",
      name: "projectTemplates:content.facilities-service-desk.fields.howUrgent",
      type: "dropdown",
      options: [
        {
          key: "danger",
          label:
            "projectTemplates:content.facilities-service-desk.options.howUrgent.danger",
        },
        {
          key: "stops-work",
          label:
            "projectTemplates:content.facilities-service-desk.options.howUrgent.stopsWork",
        },
        {
          key: "inconvenient",
          label:
            "projectTemplates:content.facilities-service-desk.options.howUrgent.inconvenient",
        },
        {
          key: "can-schedule",
          label:
            "projectTemplates:content.facilities-service-desk.options.howUrgent.canSchedule",
        },
      ],
    },
    {
      key: "date-needed",
      name: "projectTemplates:content.facilities-service-desk.fields.dateNeeded",
      type: "date",
    },
  ],

  views: [
    {
      name: "projectTemplates:content.facilities-service-desk.views.myJobs",
      filters: {
        root: {
          op: "and",
          children: [
            { key: "assignee", operator: "in", values: ["me"] },
            { key: "group", operator: "in", values: OPEN },
          ],
        },
      },
      display: {
        layout: "list",
        groupBy: "status",
        orderBy: { field: "priority" },
      },
    },
    {
      name: "projectTemplates:common.views.unassigned",
      filters: {
        root: {
          op: "and",
          children: [
            { key: "assignee", operator: "in", values: ["none"] },
            { key: "group", operator: "in", values: OPEN },
          ],
        },
      },
      display: {
        layout: "list",
        groupBy: "status",
        orderBy: { field: "priority" },
      },
    },
    {
      name: "projectTemplates:common.views.breachingSoon",
      description:
        "projectTemplates:content.facilities-service-desk.views.breachingSoonDescription",
      filters: {
        root: {
          op: "and",
          children: [
            { key: "group", operator: "in", values: OPEN },
            {
              op: "or",
              children: [
                {
                  key: "dueDate",
                  operator: "withinNext",
                  amount: 1,
                  unit: "days",
                },
                { key: "dueDate", operator: "in", values: ["past"] },
              ],
            },
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
      name: "projectTemplates:content.facilities-service-desk.views.schedule",
      description:
        "projectTemplates:content.facilities-service-desk.views.scheduleDescription",
      filters: {
        root: { key: "group", operator: "in", values: OPEN },
      },
      display: { layout: "calendar", groupBy: null },
    },
  ],

  taskTemplates: [
    {
      name: "projectTemplates:content.facilities-service-desk.taskTemplates.repair.name",
      description:
        "projectTemplates:content.facilities-service-desk.taskTemplates.repair.description",
      priority: "medium",
    },
    {
      name: "projectTemplates:content.facilities-service-desk.taskTemplates.move.name",
      description:
        "projectTemplates:content.facilities-service-desk.taskTemplates.move.description",
      column: "scheduled",
      priority: "low",
      subtasks: [
        "projectTemplates:content.facilities-service-desk.subtasks.confirmDate",
        "projectTemplates:content.facilities-service-desk.subtasks.bookMovers",
        "projectTemplates:content.facilities-service-desk.subtasks.moveFurniture",
        "projectTemplates:content.facilities-service-desk.subtasks.movePhones",
        "projectTemplates:content.facilities-service-desk.subtasks.updateFloorPlan",
      ],
    },
    {
      name: "projectTemplates:content.facilities-service-desk.taskTemplates.setup.name",
      description:
        "projectTemplates:content.facilities-service-desk.taskTemplates.setup.description",
      column: "scheduled",
      priority: "medium",
    },
    {
      name: "projectTemplates:content.facilities-service-desk.taskTemplates.safetyHazard.name",
      description:
        "projectTemplates:content.facilities-service-desk.taskTemplates.safetyHazard.description",
      priority: "urgent",
      labels: ["safety"],
    },
    {
      name: "projectTemplates:content.facilities-service-desk.taskTemplates.access.name",
      description:
        "projectTemplates:content.facilities-service-desk.taskTemplates.access.description",
      priority: "low",
    },
  ],

  automationRules: [
    {
      name: "projectTemplates:content.facilities-service-desk.rules.safetyFirst",
      trigger: { type: "task_created", fromIntake: true },
      conditions: {
        op: "and",
        conditions: [
          {
            field: "custom_field",
            fieldKey: "request-type",
            op: "equals",
            value: "safety-hazard",
          },
        ],
      },
      actions: [
        { type: "set_priority", priority: "urgent" },
        { type: "add_label", label: "safety" },
        { type: "set_due_date", offsetDays: 0 },
        {
          type: "notify",
          roles: ["lead"],
          message:
            "projectTemplates:content.facilities-service-desk.rules.safetyMessage",
        },
      ],
    },
    {
      name: "projectTemplates:content.facilities-service-desk.rules.targetUrgent",
      trigger: { type: "task_created", fromIntake: true },
      conditions: {
        op: "and",
        conditions: [{ field: "priority", op: "is", values: ["urgent"] }],
      },
      actions: [{ type: "set_due_date", offsetDays: 0 }],
    },
    {
      name: "projectTemplates:content.facilities-service-desk.rules.targetHigh",
      trigger: { type: "task_created", fromIntake: true },
      conditions: {
        op: "and",
        conditions: [{ field: "priority", op: "is", values: ["high"] }],
      },
      actions: [{ type: "set_due_date", offsetDays: 1 }],
    },
    {
      name: "projectTemplates:content.facilities-service-desk.rules.targetMedium",
      trigger: { type: "task_created", fromIntake: true },
      conditions: {
        op: "and",
        conditions: [{ field: "priority", op: "is", values: ["medium"] }],
      },
      actions: [{ type: "set_due_date", offsetDays: 7 }],
    },
    {
      name: "projectTemplates:content.facilities-service-desk.rules.targetLow",
      trigger: { type: "task_created", fromIntake: true },
      conditions: {
        op: "and",
        conditions: [{ field: "priority", op: "is", values: ["low"] }],
      },
      actions: [{ type: "set_due_date", offsetDays: 30 }],
    },
    {
      name: "projectTemplates:content.facilities-service-desk.rules.lateOwner",
      trigger: { type: "due_date_passed" },
      // Finished jobs keep their due date; nobody needs to hear about those.
      conditions: {
        op: "and",
        conditions: [
          { field: "status", op: "is_not", columns: ["done", "wont-do"] },
        ],
      },
      actions: [
        {
          type: "notify",
          roles: ["assignees"],
          message:
            "projectTemplates:content.facilities-service-desk.rules.lateMessage",
        },
      ],
    },
  ],

  intakeForm: {
    title: "projectTemplates:content.facilities-service-desk.form.title",
    intro: "projectTemplates:content.facilities-service-desk.form.intro",
    descriptionField: "optional",
    emailField: "required",
    nameField: "optional",
    customFields: ["request-type", "location", "how-urgent", "date-needed"],
    confirmationMessage:
      "projectTemplates:content.facilities-service-desk.form.confirmation",
  },

  pages: [
    {
      key: "emergency",
      title:
        "projectTemplates:content.facilities-service-desk.pages.emergency.title",
      logo: { kind: "icon", value: "Phone" },
      sections: [
        {
          heading: "projectTemplates:common.pages.whoToCall",
          starter:
            "projectTemplates:content.facilities-service-desk.pages.emergency.whoToCallStarter",
        },
        {
          heading:
            "projectTemplates:content.facilities-service-desk.pages.emergency.useTheForm",
          starter:
            "projectTemplates:content.facilities-service-desk.pages.emergency.useTheFormStarter",
        },
        {
          heading:
            "projectTemplates:content.facilities-service-desk.pages.emergency.targets",
          starter:
            "projectTemplates:content.facilities-service-desk.pages.emergency.targetsStarter",
        },
      ],
    },
    {
      key: "building-guide",
      title:
        "projectTemplates:content.facilities-service-desk.pages.buildingGuide.title",
      logo: { kind: "icon", value: "Building2" },
      sections: [
        {
          heading:
            "projectTemplates:content.facilities-service-desk.pages.buildingGuide.floors",
          starter: "-",
        },
        {
          heading:
            "projectTemplates:content.facilities-service-desk.pages.buildingGuide.supplies",
          starter:
            "projectTemplates:content.facilities-service-desk.pages.buildingGuide.suppliesStarter",
        },
        {
          heading:
            "projectTemplates:content.facilities-service-desk.pages.buildingGuide.contractors",
          starter:
            "projectTemplates:content.facilities-service-desk.pages.buildingGuide.contractorsStarter",
        },
      ],
    },
    {
      key: "move-checklist",
      title:
        "projectTemplates:content.facilities-service-desk.pages.moveChecklist.title",
      logo: { kind: "icon", value: "List" },
      sections: [
        {
          heading: "projectTemplates:common.pages.leadTimes",
          starter:
            "projectTemplates:content.facilities-service-desk.pages.moveChecklist.leadTimesStarter",
        },
        {
          heading:
            "projectTemplates:content.facilities-service-desk.pages.moveChecklist.before",
          starter: "- [ ]",
        },
        {
          heading:
            "projectTemplates:content.facilities-service-desk.pages.moveChecklist.movingDay",
          starter: "- [ ]",
        },
        {
          heading:
            "projectTemplates:content.facilities-service-desk.pages.moveChecklist.after",
          starter: "- [ ]",
        },
      ],
    },
    {
      key: "planned-maintenance",
      title:
        "projectTemplates:content.facilities-service-desk.pages.maintenance.title",
      logo: { kind: "icon", value: "Calendar" },
      sections: [
        {
          heading:
            "projectTemplates:content.facilities-service-desk.pages.maintenance.fireAlarms",
          starter:
            "projectTemplates:content.facilities-service-desk.pages.maintenance.checkStarter",
        },
        {
          heading:
            "projectTemplates:content.facilities-service-desk.pages.maintenance.heating",
          starter:
            "projectTemplates:content.facilities-service-desk.pages.maintenance.checkStarter",
        },
        {
          heading:
            "projectTemplates:content.facilities-service-desk.pages.maintenance.lifts",
          starter:
            "projectTemplates:content.facilities-service-desk.pages.maintenance.checkStarter",
        },
      ],
    },
  ],

  sample: {
    tasks: [
      {
        key: "tap",
        title: "projectTemplates:content.facilities-service-desk.samples.tap",
        description:
          "projectTemplates:content.facilities-service-desk.samples.tapDescription",
        column: "waiting",
        priority: "high",
        labels: ["contractor"],
        assignee: "creator",
        startInDays: -1,
        dueInDays: 1,
        customFields: {
          "request-type": "repair",
          location:
            "projectTemplates:content.facilities-service-desk.samples.tapLocation",
          "how-urgent": "stops-work",
        },
      },
      {
        key: "carpet",
        title:
          "projectTemplates:content.facilities-service-desk.samples.carpet",
        description:
          "projectTemplates:content.facilities-service-desk.samples.carpetDescription",
        column: "done",
        priority: "urgent",
        labels: ["safety"],
        startInDays: -2,
        dueInDays: -2,
        customFields: {
          "request-type": "safety-hazard",
          location:
            "projectTemplates:content.facilities-service-desk.samples.carpetLocation",
          "how-urgent": "danger",
        },
      },
      {
        // Sample dates are relative; a custom date field only takes a fixed
        // day, so the due date carries the move date instead.
        key: "team-move",
        title:
          "projectTemplates:content.facilities-service-desk.samples.teamMove",
        description:
          "projectTemplates:content.facilities-service-desk.samples.teamMoveDescription",
        column: "scheduled",
        priority: "low",
        dueInDays: 12,
        customFields: {
          "request-type": "move",
          location:
            "projectTemplates:content.facilities-service-desk.samples.teamMoveLocation",
          "how-urgent": "can-schedule",
        },
        subtasks: [
          "projectTemplates:content.facilities-service-desk.subtasks.bookMovers",
          "projectTemplates:content.facilities-service-desk.subtasks.movePhones",
        ],
      },
      {
        key: "town-hall",
        title:
          "projectTemplates:content.facilities-service-desk.samples.townHall",
        description:
          "projectTemplates:content.facilities-service-desk.samples.townHallDescription",
        column: "scheduled",
        priority: "medium",
        startInDays: 24,
        dueInDays: 25,
        customFields: {
          "request-type": "setup",
          location:
            "projectTemplates:content.facilities-service-desk.samples.townHallLocation",
          "how-urgent": "can-schedule",
        },
      },
      {
        key: "cold-room",
        title:
          "projectTemplates:content.facilities-service-desk.samples.coldRoom",
        description:
          "projectTemplates:content.facilities-service-desk.samples.coldRoomDescription",
        column: "in-progress",
        priority: "medium",
        labels: ["recurring"],
        assignee: "creator",
        startInDays: 0,
        dueInDays: 5,
        customFields: {
          "request-type": "repair",
          location:
            "projectTemplates:content.facilities-service-desk.samples.coldRoomLocation",
          "how-urgent": "inconvenient",
        },
      },
      {
        key: "access-card",
        title:
          "projectTemplates:content.facilities-service-desk.samples.accessCard",
        column: "new",
        priority: "low",
        dueInDays: 20,
        customFields: {
          "request-type": "access",
          location:
            "projectTemplates:content.facilities-service-desk.samples.accessCardLocation",
          "how-urgent": "can-schedule",
        },
      },
    ],
  },
};

export default template;
