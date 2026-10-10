import type { Comparison } from "./types";

export const wekan: Comparison = {
  slug: "wekan",
  competitor: "WeKan",
  categories: ["kanban", "open-source"],
  title: "Margaya vs WeKan: an open-source WeKan alternative",
  description:
    "Compare Margaya and WeKan, two MIT-licensed kanban tools: Margaya adds list, spreadsheet and Gantt views, cycles, intake and live docs, on PostgreSQL.",
  summary:
    "Kanban plus lists, Gantt, cycles and docs, both MIT licensed, with Margaya on PostgreSQL.",
  verdict:
    "Choose WeKan for a long-standing kanban board with swimlanes and many install options; choose Margaya when the board needs to become a project with views, planning and docs.",
  glance: {
    hosting: "Self-host with Docker, Snap and other packages",
    licence: "MIT",
    pricing: "Free",
    bestFor: "Teams that want a self-hosted kanban board with swimlanes",
    margayaBestFor:
      "Teams that want kanban plus lists, timelines, planning and docs",
  },
  them: {
    cycles: "no",
    modules: ["partial", "Swimlanes"],
    estimates: ["partial", "Card fields"],
    customFields: "yes",
    timeTracking: ["partial", "Spent-time field"],
    relations: ["partial", "Subtasks and checklists"],
    board: ["yes", "With swimlanes"],
    list: ["partial", "Lists view"],
    calendar: "yes",
    gantt: ["partial", "In recent releases"],
    savedViews: ["partial", "Board filters"],
    pages: "no",
    coEditing: "no",
    intake: "no",
    inbox: ["partial", "Notifications"],
    publicBoards: ["yes", "Public boards"],
    automations: ["yes", "Rules with triggers and actions"],
    api: ["yes", "REST API and webhooks"],
    mcp: ["no", "Not built in"],
    integrations: ["partial", "Outgoing webhooks"],
    openSource: ["yes", "MIT"],
    selfHost: ["yes", "Meteor and MongoDB"],
    sso: ["yes", "OIDC, LDAP and more"],
    auditLog: ["partial", "Board activity"],
    freeSelfHost: "yes",
    managedCloud: ["partial", "Third-party hosts"],
    allFeatures: "yes",
  },
  shines: [
    {
      title: "Many ways to install",
      body: "Docker, Snap and a long list of other packages and platforms make WeKan easy to drop into almost any environment.",
    },
    {
      title: "Swimlanes and rules",
      body: "Swimlanes, card templates and a trigger-and-action rule engine give a classic board real flexibility.",
    },
    {
      title: "Around for a long time",
      body: "WeKan has a long history and an active maintainer, with frequent releases.",
    },
  ],
  different: [
    {
      title: "More than a board",
      body: "List, spreadsheet, calendar and Gantt layouts, saved views and a capture bar make the same tasks useful for planning, triage and review.",
    },
    {
      title: "Planning and docs",
      body: "Cycles, modules, estimates, intake and project pages with live co-editing turn a board into a project when the work calls for it.",
    },
    {
      title: "PostgreSQL",
      body: "Margaya stores everything in PostgreSQL, which many teams already back up, monitor and know how to run.",
    },
  ],
  migration:
    "WeKan can export a board as CSV. Import the file into a Margaya project and map lists to columns, members to workspace members, and labels and dates to Margaya fields.",
  faq: [
    {
      question: "Are both tools MIT licensed?",
      answer:
        "Yes. Both WeKan and Margaya are open source under the MIT licence and free to self-host.",
    },
    {
      question: "Does Margaya have swimlanes?",
      answer:
        "In effect, yes. A board can be grouped and sub-grouped by task properties such as priority or assignee, which gives you swimlanes, and you can save each layout as a view.",
    },
    {
      question: "What database does Margaya use?",
      answer:
        "PostgreSQL. Redis is optional and only needed to share realtime updates between several API instances.",
    },
  ],
  related: ["kanboard", "trello", "focalboard", "vikunja"],
  screenshot: "board",
  reviewedOn: "2026-10-15",
};
