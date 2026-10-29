import type { Comparison } from "./types";

export const clickup: Comparison = {
  slug: "clickup",
  competitor: "ClickUp",
  categories: ["all-in-one"],
  title: "Margaya vs ClickUp: a simpler, open-source ClickUp alternative",
  description:
    "Compare Margaya and ClickUp: boards, lists, Gantt, docs, cycles and time tracking in a calmer, MIT-licensed tool that you can self-host for free.",
  summary:
    "The planning features teams actually use, in a calmer tool you can self-host.",
  verdict:
    "Choose ClickUp if you want one app for tasks, docs, chat, whiteboards and dashboards; choose Margaya for a quieter tracker that covers the planning core and stays fast on busy boards.",
  glance: {
    hosting: "Cloud only",
    licence: "Proprietary",
    pricing: "Free plan, then paid per-user plans",
    bestFor:
      "Teams that want to replace several tools with one large workspace",
    margayaBestFor:
      "Teams that want the planning core without configuring a workspace for weeks",
  },
  them: {
    cycles: ["yes", "Sprints"],
    modules: ["yes", "Folders, lists and milestones"],
    estimates: ["yes", "Points or time"],
    customFields: "yes",
    timeTracking: "yes",
    relations: ["yes", "Subtasks and dependencies"],
    board: "yes",
    list: "yes",
    calendar: "yes",
    gantt: "yes",
    savedViews: "yes",
    pages: ["yes", "ClickUp Docs"],
    coEditing: "yes",
    intake: ["yes", "Forms"],
    inbox: "yes",
    publicBoards: ["partial", "Public share links"],
    automations: ["yes", "Usage limits by plan"],
    api: "yes",
    aiAssistant: ["yes", "ClickUp Brain, credits vary by plan"],
    mcp: ["yes", "Official MCP server"],
    integrations: "yes",
    openSource: "no",
    selfHost: "no",
    sso: ["partial", "Enterprise plan"],
    auditLog: ["partial", "Enterprise plan"],
    freeSelfHost: "no",
    managedCloud: "yes",
    allFeatures: ["no", "Features and limits tiered by plan"],
  },
  shines: [
    {
      title: "Breadth in one place",
      body: "Tasks, docs, whiteboards, chat, goals and dashboards share one workspace, so teams that want a single app can genuinely have one.",
    },
    {
      title: "Endlessly configurable",
      body: "Statuses, custom fields and views can be tuned per space, folder and list, which suits organisations with very different teams.",
    },
    {
      title: "A generous free plan",
      body: "Small teams get a lot of functionality before they need to pay.",
    },
  ],
  different: [
    {
      title: "Calm by design",
      body: "Margaya shows only what a project uses. Cycles, modules, estimates, intake and time tracking are switched on per project, so routine work never gets heavier.",
    },
    {
      title: "Fast on big boards",
      body: "Margaya is built to stay responsive on task-heavy boards, and changes from teammates arrive live over WebSockets without reloading.",
    },
    {
      title: "Open and portable",
      body: "MIT licensed, free to self-host with every feature, and backed by a documented REST API, signed webhooks and a built-in MCP endpoint.",
    },
  ],
  migration:
    "ClickUp exports tasks as CSV from a space, folder or list. Import the file into a Margaya project, map statuses, assignees, tags, priorities and dates, and review anything that does not match before you import.",
  faq: [
    {
      question: "Is Margaya easier to set up than ClickUp?",
      answer:
        "Yes, by design. A new Margaya project starts with a board, columns and a capture bar. You add planning features when a project needs them, not before.",
    },
    {
      question: "Does Margaya have docs like ClickUp?",
      answer:
        "Every project has pages: a tree of docs with live co-editing, version history, backlinks and private drafts. Margaya does not include chat or whiteboards.",
    },
    {
      question: "Can I self-host a ClickUp alternative?",
      answer:
        "Margaya runs with Docker Compose or on Kubernetes with the Helm chart. It needs PostgreSQL; Redis is optional and only used when you run several API instances.",
    },
  ],
  related: ["asana", "monday", "notion", "huly"],
  screenshot: "gantt",
  reviewedOn: "2026-10-15",
};
