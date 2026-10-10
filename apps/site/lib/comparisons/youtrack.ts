import type { Comparison } from "./types";

export const youtrack: Comparison = {
  slug: "youtrack",
  competitor: "YouTrack",
  categories: ["issue-tracker"],
  title: "Margaya vs YouTrack: an open-source YouTrack alternative",
  description:
    "Compare Margaya and YouTrack: cycles, Gantt, time tracking, docs and intake in an MIT-licensed tracker that is free to self-host for any team size.",
  summary:
    "Agile planning, Gantt and time tracking under the MIT licence, with no user cap when self-hosted.",
  verdict:
    "Choose YouTrack for a powerful query language and scriptable workflows in the JetBrains ecosystem; choose Margaya for an open-source tracker with no user cap that is quicker to learn.",
  glance: {
    hosting: "JetBrains cloud, or self-hosted YouTrack Server",
    licence: "Proprietary",
    pricing: "Free for small teams, then paid per-user plans",
    bestFor: "Teams that want deep querying and scriptable workflows",
    margayaBestFor:
      "Teams that want open source and no user cap without scripting their tracker",
  },
  them: {
    cycles: ["yes", "Agile boards with sprints"],
    modules: ["yes", "Epics"],
    estimates: "yes",
    customFields: "yes",
    timeTracking: "yes",
    relations: "yes",
    board: "yes",
    list: "yes",
    calendar: ["partial", "Through apps"],
    gantt: "yes",
    savedViews: ["yes", "Saved searches"],
    pages: ["yes", "Knowledge base"],
    coEditing: ["partial", "Knowledge base articles"],
    intake: ["yes", "Helpdesk projects"],
    inbox: "yes",
    publicBoards: ["partial", "Guest access to projects"],
    automations: ["yes", "Scriptable JavaScript workflows"],
    api: "yes",
    mcp: ["yes", "MCP server"],
    integrations: "yes",
    openSource: "no",
    selfHost: ["yes", "YouTrack Server"],
    sso: "yes",
    auditLog: "yes",
    freeSelfHost: ["partial", "Free for small teams"],
    managedCloud: "yes",
    allFeatures: ["partial", "Priced mainly by user count"],
  },
  shines: [
    {
      title: "A query language that scales",
      body: "YouTrack's search syntax and saved searches let power users slice thousands of issues in seconds.",
    },
    {
      title: "Workflows as code",
      body: "JavaScript workflows can enforce rules, set fields and react to changes in ways few trackers allow.",
    },
    {
      title: "Helpdesk and knowledge base",
      body: "Support tickets, a knowledge base and agile boards live in one product, with first-class JetBrains IDE integration.",
    },
  ],
  different: [
    {
      title: "Open source, no user cap",
      body: "Margaya is MIT licensed and free to self-host for any number of users, with every feature included.",
    },
    {
      title: "Quick to learn",
      body: "Filters, display options and saved views replace a query language for everyday work, and the capture bar adds tasks without opening a form.",
    },
    {
      title: "Built for collaboration on docs",
      body: "Project pages support live co-editing with cursors, version history and backlinks to the tasks they mention.",
    },
  ],
  migration:
    "YouTrack exports issue lists as CSV. Import the file into a Margaya project and map states, assignees, priorities, tags and dates; the review step shows any value that does not match before you import.",
  faq: [
    {
      question: "Is Margaya free for more than ten users?",
      answer:
        "Yes. Self-hosted Margaya has no user limit and no paid tier. Margaya Cloud is a managed subscription for teams that would rather not run a server.",
    },
    {
      question: "Does Margaya have time tracking like YouTrack?",
      answer:
        "Yes. Time tracking is a project feature: log time entries on any task, see the totals, and export them with the project's tasks.",
    },
    {
      question: "Can Margaya run scripted workflows?",
      answer:
        "Not inside the app. Margaya has scheduled cleanup and Git-driven workflow rules, and anything more custom can run outside it through the REST API, signed webhooks or MCP.",
    },
  ],
  related: ["jira", "redmine", "openproject", "linear"],
  screenshot: "task",
  reviewedOn: "2026-10-15",
};
