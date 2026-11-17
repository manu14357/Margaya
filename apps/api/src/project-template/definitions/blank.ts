import type { ProjectTemplate } from "../types";

// plans/create-flow-and-templates/03-templates/catalog/blank.md

const template: ProjectTemplate = {
  id: "blank",
  version: 1,
  categories: [
    "software-development",
    "design",
    "finance",
    "human-resources",
    "legal",
    "marketing",
    "operations",
    "personal",
    "sales",
    "service-management",
    "work-management",
  ],
  icon: "Layout",
  name: "projectTemplates:catalog.blank.name",
  pitch: "projectTemplates:catalog.blank.pitch",
  description: "projectTemplates:catalog.blank.description",
  suggestedKey: "PRJ",

  // Blank means blank: no description, labels, fields, views, pages or
  // samples. Every feature stays reachable in project settings.
  project: {
    features: {
      cycles: false,
      modules: false,
      views: false,
      pages: false,
      whiteboards: false,
      intake: false,
      estimates: false,
      timeTracking: false,
      ai: false,
      updates: false,
    },
    lead: "creator",
  },

  // The Backlog tab already holds planned work, so there is no Backlog column.
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
      key: "done",
      name: "projectTemplates:common.statuses.done",
      group: "completed",
    },
  ],
};

export default template;
