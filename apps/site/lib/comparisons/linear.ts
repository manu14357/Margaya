import type { Comparison } from "./types";

export const linear: Comparison = {
  slug: "linear",
  competitor: "Linear",
  categories: ["issue-tracker"],
  title: "Margaya vs Linear: a self-hosted Linear alternative",
  description:
    "Compare Margaya and Linear: cycles, triage, keyboard-first speed and docs, plus Gantt, time tracking and custom fields in an MIT tool you can self-host.",
  summary:
    "Cycles, triage and a keyboard-first workflow you can run on your own servers.",
  verdict:
    "Choose Linear for a polished cloud tracker with an opinionated product workflow; choose Margaya for a similar keyboard-first pace with more views and fields, and the option to host it yourself.",
  glance: {
    hosting: "Cloud only",
    licence: "Proprietary",
    pricing: "Free plan, then paid per-user plans",
    bestFor:
      "Product and engineering teams happy with a cloud-only, opinionated tool",
    margayaBestFor:
      "Teams that want Linear-like speed plus Gantt, time tracking and self-hosting",
  },
  them: {
    cycles: "yes",
    modules: ["yes", "Projects, milestones and initiatives"],
    estimates: "yes",
    customFields: ["partial", "Labels and built-in fields"],
    timeTracking: "no",
    relations: "yes",
    board: "yes",
    list: "yes",
    calendar: "no",
    gantt: ["yes", "Project timeline"],
    savedViews: "yes",
    pages: ["yes", "Project documents"],
    coEditing: "yes",
    intake: ["yes", "Triage and requests"],
    inbox: "yes",
    publicBoards: "no",
    automations: ["partial", "Git workflows, auto-close and triage rules"],
    api: ["yes", "GraphQL API and webhooks"],
    mcp: ["yes", "Official MCP server"],
    integrations: "yes",
    openSource: "no",
    selfHost: "no",
    sso: ["partial", "Enterprise plan"],
    auditLog: ["partial", "Enterprise plan"],
    freeSelfHost: "no",
    managedCloud: "yes",
    allFeatures: ["no", "Features tiered by plan"],
  },
  shines: [
    {
      title: "Craft and speed",
      body: "Linear's interface is famously fast and carefully designed, and its keyboard shortcuts make it a pleasure for people who live in the tracker.",
    },
    {
      title: "An opinionated workflow",
      body: "Cycles, triage and projects come with sensible defaults, so product teams can adopt a working process without designing one.",
    },
    {
      title: "Product planning at the top",
      body: "Initiatives and project updates give leadership a clear view of where larger bets stand.",
    },
  ],
  different: [
    {
      title: "Self-host the same pace",
      body: "Margaya is keyboard-first too, with a command palette and a capture bar, and it runs on your own servers under the MIT licence when that matters.",
    },
    {
      title: "More ways to look at work",
      body: "Alongside board and list, Margaya has a spreadsheet, a calendar and a Gantt timeline with dependency lines, plus custom fields and time tracking.",
    },
    {
      title: "Open to the outside",
      body: "Publish a project as a public board where visitors can vote, comment and send requests into intake, without giving them an account in your workspace.",
    },
  ],
  migration:
    "Linear exports issues as CSV from its settings. Import that file into a Margaya project, map statuses to columns, match assignees by email, and bring labels, priorities, estimates and dates across.",
  faq: [
    {
      question: "Can I self-host Linear?",
      answer:
        "No, Linear is cloud only. If self-hosting is a requirement, Margaya offers cycles, triage through intake, and a keyboard-first workflow you can run with Docker or Helm.",
    },
    {
      question: "Does Margaya have cycles like Linear?",
      answer:
        "Yes. Cycles are time-boxed iterations whose status follows their dates, with a burndown and burn-up chart and carryover of unfinished tasks. They are optional for each project.",
    },
    {
      question: "Does Margaya work with AI assistants?",
      answer:
        "Yes. Every Margaya instance has a built-in MCP endpoint, and an MCP package is available for clients that prefer a local stdio server.",
    },
  ],
  related: ["jira", "shortcut", "github-projects", "huly"],
  screenshot: "list",
  reviewedOn: "2026-10-15",
};
