import type { Comparison } from "./types";

export const taiga: Comparison = {
  slug: "taiga",
  competitor: "Taiga",
  categories: ["issue-tracker", "open-source"],
  title: "Margaya vs Taiga: an open-source Taiga alternative",
  description:
    "Compare Margaya and Taiga, two open-source agile tools: sprints, epics and boards, plus Gantt, calendar, intake, time tracking and live docs in Margaya.",
  summary:
    "Agile planning plus Gantt, calendar, intake and time tracking, MIT licensed.",
  verdict:
    "Choose Taiga for a Scrum-first tool with a polished backlog and sprint flow; choose Margaya when you also want calendars, a Gantt, intake, time tracking and co-edited docs.",
  glance: {
    hosting: "Self-host, or Taiga's cloud",
    licence: "MPL-2.0",
    pricing: "Free to self-host; paid cloud plans",
    bestFor: "Teams that run Scrum or Kanban by the book",
    margayaBestFor:
      "Teams that want sprints plus dates, intake and docs in one open-source tool",
  },
  them: {
    cycles: ["yes", "Sprints with burndown"],
    modules: ["yes", "Epics"],
    estimates: ["yes", "Story points"],
    customFields: "yes",
    timeTracking: "no",
    relations: ["partial", "Tasks inside stories, epics"],
    board: "yes",
    list: ["yes", "Backlog and issue list"],
    calendar: "no",
    gantt: "no",
    savedViews: ["partial", "Saved filters"],
    pages: ["yes", "Wiki"],
    coEditing: "no",
    intake: ["partial", "Separate issues module"],
    inbox: ["partial", "Email notifications"],
    publicBoards: ["yes", "Public projects"],
    automations: "no",
    api: ["yes", "REST API and webhooks"],
    aiAssistant: ["no", "Not built in"],
    mcp: ["no", "Not built in"],
    integrations: ["yes", "GitHub, GitLab, Slack and more"],
    openSource: ["yes", "MPL-2.0"],
    selfHost: "yes",
    sso: ["partial", "Through community plugins"],
    auditLog: ["partial", "Activity timeline"],
    freeSelfHost: "yes",
    managedCloud: "yes",
    allFeatures: "yes",
  },
  shines: [
    {
      title: "Scrum done properly",
      body: "User stories, story points, sprint planning and burndown charts follow agile practice closely, which coaches and Scrum teams appreciate.",
    },
    {
      title: "A clean backlog",
      body: "Taiga's backlog makes refinement and sprint planning feel natural, with drag and drop between backlog and sprints.",
    },
    {
      title: "Open and established",
      body: "Taiga has been open source for many years, with a cloud option for teams that prefer not to host it.",
    },
  ],
  different: [
    {
      title: "Dates as well as sprints",
      body: "Calendar and Gantt layouts, start and due dates and dependency lines sit beside cycles and modules, so time-based planning has a home too.",
    },
    {
      title: "Intake and inbox",
      body: "Requests wait in an intake queue until accepted, and each person gets an inbox and optional daily or weekly digests for the tasks they follow.",
    },
    {
      title: "Docs and time in one place",
      body: "Project pages with live co-editing and per-task time tracking mean fewer tools around the tracker.",
    },
  ],
  migration:
    "Taiga exports user stories, tasks and issues as CSV from the project's admin reports. Import the file into a Margaya project and map status, assignee, tags and dates.",
  faq: [
    {
      question: "Does Margaya do story points and burndown?",
      answer:
        "Yes. Estimates can be points, categories or time, and each cycle shows a burndown and burn-up chart broken down by assignee, label and priority.",
    },
    {
      question: "Which is easier to self-host?",
      answer:
        "Margaya runs as one application container plus PostgreSQL, with Redis only needed when you scale out to several API instances.",
    },
    {
      question: "Are both open source?",
      answer:
        "Yes. Taiga is MPL-2.0 and Margaya is MIT, and both can be self-hosted for free.",
    },
  ],
  related: ["openproject", "redmine", "jira", "leantime"],
  screenshot: "cycles",
  reviewedOn: "2026-10-15",
};
