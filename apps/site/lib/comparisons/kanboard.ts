import type { Comparison } from "./types";

export const kanboard: Comparison = {
  slug: "kanboard",
  competitor: "Kanboard",
  categories: ["kanban", "open-source"],
  title: "Margaya vs Kanboard: a modern open-source Kanboard alternative",
  description:
    "Compare Margaya and Kanboard, two MIT-licensed self-hosted tools: Margaya adds live updates, saved views, cycles, intake and co-edited docs for teams.",
  summary:
    "Both MIT and self-hosted; Margaya adds live updates, planning and docs for growing teams.",
  verdict:
    "Choose Kanboard for a minimal board that runs on almost nothing; choose Margaya when a team wants live collaboration, more views and planning without hunting for plugins.",
  glance: {
    hosting: "Self-host, PHP with SQLite, MySQL or PostgreSQL",
    licence: "MIT",
    pricing: "Free",
    bestFor: "Individuals and small teams who value a tiny footprint",
    margayaBestFor:
      "Teams that want live collaboration, views and planning in one install",
  },
  them: {
    cycles: "no",
    modules: ["partial", "Swimlanes and categories"],
    estimates: ["partial", "Complexity score"],
    customFields: ["partial", "Through plugins"],
    timeTracking: ["yes", "Time spent and estimated"],
    relations: ["yes", "Subtasks and task links"],
    board: ["yes", "With swimlanes"],
    list: "yes",
    calendar: "yes",
    gantt: ["yes", "Project and task Gantt"],
    savedViews: ["partial", "Custom filters"],
    pages: "no",
    coEditing: "no",
    intake: ["partial", "Create tasks by email"],
    inbox: ["partial", "Notifications"],
    publicBoards: ["yes", "Public read-only boards"],
    automations: ["yes", "Automatic actions"],
    api: ["yes", "JSON-RPC API and webhooks"],
    aiAssistant: ["no", "Not built in"],
    mcp: ["no", "Not built in"],
    integrations: ["partial", "Through plugins"],
    openSource: ["yes", "MIT"],
    selfHost: "yes",
    sso: ["partial", "LDAP, or plugins"],
    auditLog: ["partial", "Project activity"],
    freeSelfHost: "yes",
    managedCloud: "no",
    allFeatures: "yes",
  },
  shines: [
    {
      title: "A tiny footprint",
      body: "PHP and an SQLite file are enough. Kanboard runs for years on the smallest server with almost no attention.",
    },
    {
      title: "Automatic actions",
      body: "A simple rules system moves, assigns and closes tasks on events, without any scripting.",
    },
    {
      title: "Focused on kanban",
      body: "Kanboard deliberately limits work in progress and keeps the interface minimal, which suits teams that practise kanban strictly.",
    },
  ],
  different: [
    {
      title: "Live collaboration",
      body: "Changes appear for everyone instantly over WebSockets, and project pages support live co-editing with cursors and version history.",
    },
    {
      title: "Planning built in",
      body: "Cycles with burndown, modules, estimates, custom fields, intake and saved views are part of Margaya rather than plugins.",
    },
    {
      title: "Managed option",
      body: "Margaya Cloud runs the same open-source product for teams that would rather not host anything, with no lock-in either way.",
    },
  ],
  migration:
    "Kanboard exports a project's tasks as CSV. Import the file into a Margaya project and map columns, assignees, categories, dates and descriptions to Margaya fields.",
  faq: [
    {
      question: "Are both tools MIT licensed?",
      answer:
        "Yes. Kanboard and Margaya are both MIT licensed and free to self-host.",
    },
    {
      question: "Is Margaya heavier to run than Kanboard?",
      answer:
        "Somewhat. Margaya needs one application container and PostgreSQL, which is still modest, while Kanboard can run on PHP and SQLite.",
    },
    {
      question: "Does Margaya have automatic actions?",
      answer:
        "Yes. Margaya has When, If, Then rules that react to task changes, such as assigning or labelling new tasks, scheduled cleanup rules that archive closed tasks and close stale ones, and Git rules that move tasks when pull requests open or merge.",
    },
  ],
  related: ["wekan", "trello", "vikunja", "redmine"],
  screenshot: "board",
  reviewedOn: "2026-10-15",
};
