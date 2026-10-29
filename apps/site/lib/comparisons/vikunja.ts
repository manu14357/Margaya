import type { Comparison } from "./types";

export const vikunja: Comparison = {
  slug: "vikunja",
  competitor: "Vikunja",
  categories: ["kanban", "open-source"],
  title: "Margaya vs Vikunja: a team-first open-source alternative",
  description:
    "Compare Margaya and Vikunja, two self-hosted task tools: Margaya adds cycles, intake, docs, custom fields, time tracking and workspace roles for teams.",
  summary:
    "From personal to-dos to team projects: cycles, intake, docs and roles, MIT licensed.",
  verdict:
    "Choose Vikunja for a lightweight personal or household to-do app you host yourself; choose Margaya when a team needs roles, planning, intake and shared docs.",
  glance: {
    hosting: "Self-host, or Vikunja's cloud",
    licence: "AGPLv3",
    pricing: "Free to self-host; paid cloud plans",
    bestFor: "Personal task management and small shared lists",
    margayaBestFor:
      "Teams that need roles, cycles, intake and docs beyond shared lists",
  },
  them: {
    cycles: "no",
    modules: ["partial", "Projects and sub-projects"],
    estimates: "no",
    customFields: "no",
    timeTracking: "no",
    relations: ["yes", "Subtasks and task relations"],
    board: "yes",
    list: ["yes", "List and table"],
    calendar: ["partial", "Through CalDAV"],
    gantt: "yes",
    savedViews: ["yes", "Saved filters"],
    pages: "no",
    coEditing: "no",
    intake: "no",
    inbox: ["partial", "Notifications and reminders"],
    publicBoards: ["partial", "Link shares"],
    automations: "no",
    api: ["yes", "REST API and webhooks"],
    aiAssistant: ["no", "Not built in"],
    mcp: ["no", "Not built in"],
    integrations: ["partial", "CalDAV and importers"],
    openSource: ["yes", "AGPLv3"],
    selfHost: "yes",
    sso: ["yes", "OpenID Connect"],
    auditLog: "no",
    freeSelfHost: "yes",
    managedCloud: "yes",
    allFeatures: "yes",
  },
  shines: [
    {
      title: "Great for personal tasks",
      body: "Reminders, repeating tasks, quick-add magic and CalDAV sync make Vikunja a strong self-hosted replacement for consumer to-do apps.",
    },
    {
      title: "Small and simple",
      body: "A single binary with SQLite, MySQL or PostgreSQL keeps it easy to run on modest hardware.",
    },
    {
      title: "Importers",
      body: "Built-in importers help people move over from popular consumer to-do apps.",
    },
  ],
  different: [
    {
      title: "Made for teams",
      body: "Workspaces with roles and permissions, mentions, an inbox and email digests help a team stay coordinated rather than just sharing lists.",
    },
    {
      title: "Planning features",
      body: "Cycles, modules, estimates, custom fields and time tracking are available per project whenever a team needs more structure.",
    },
    {
      title: "Docs and intake",
      body: "Project pages with live co-editing hold specs, and an intake queue keeps incoming requests off the board until they are accepted.",
    },
  ],
  migration:
    "Vikunja can export your data as a downloadable archive. Put the tasks you want to move into a CSV file and map title, description, done state, dates, labels and assignees in Margaya's CSV import.",
  faq: [
    {
      question: "Is Margaya good for personal to-dos?",
      answer:
        "It works, and Home gives you quick links, recent items and private stickies. But Margaya is designed around teams and projects, while Vikunja is designed around personal tasks.",
    },
    {
      question: "Do both support single sign-on?",
      answer:
        "Yes. Both support OpenID Connect. Margaya also offers Google, GitHub and Discord sign-in out of the box.",
    },
    {
      question: "What does Margaya need to run?",
      answer:
        "One application container and PostgreSQL. Redis is optional and only used to fan out realtime updates across several API instances.",
    },
  ],
  related: ["trello", "kanboard", "wekan", "leantime"],
  screenshot: "board",
  reviewedOn: "2026-10-15",
};
