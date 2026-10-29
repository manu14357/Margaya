import type { Comparison } from "./types";

export const wrike: Comparison = {
  slug: "wrike",
  competitor: "Wrike",
  categories: ["all-in-one"],
  title: "Margaya vs Wrike: an open-source Wrike alternative",
  description:
    "Compare Margaya and Wrike: Gantt, custom fields, intake, time tracking and docs in a lighter MIT-licensed project tool that is free to self-host.",
  summary:
    "Gantt, intake and time tracking without an enterprise rollout. Free to self-host.",
  verdict:
    "Choose Wrike for resource planning, proofing and request workflows across large operations teams; choose Margaya for the project core in a lighter tool your team can adopt in a day.",
  glance: {
    hosting: "Cloud only",
    licence: "Proprietary",
    pricing: "Free plan, then paid per-user plans",
    bestFor: "Marketing, services and operations teams at enterprise scale",
    margayaBestFor:
      "Teams that need Gantt, intake and time tracking without an enterprise rollout",
  },
  them: {
    cycles: ["partial", "Agile templates"],
    modules: ["yes", "Projects, folders and milestones"],
    estimates: ["partial", "Effort on higher plans"],
    customFields: "yes",
    timeTracking: ["yes", "On higher plans"],
    relations: ["yes", "Subtasks and dependencies"],
    board: "yes",
    list: ["yes", "Table view"],
    calendar: "yes",
    gantt: "yes",
    savedViews: "yes",
    pages: ["partial", "Rich task and project descriptions"],
    coEditing: ["yes", "Live editor"],
    intake: ["yes", "Request forms"],
    inbox: "yes",
    publicBoards: ["partial", "External collaborators"],
    automations: ["yes", "Automation engine with plan limits"],
    api: "yes",
    aiAssistant: ["yes", "Copilot and agents from the Business plan"],
    mcp: ["yes", "Wrike MCP server"],
    integrations: "yes",
    openSource: "no",
    selfHost: "no",
    sso: ["partial", "Higher plans"],
    auditLog: ["partial", "Higher plans"],
    freeSelfHost: "no",
    managedCloud: "yes",
    allFeatures: ["no", "Features tiered by plan"],
  },
  shines: [
    {
      title: "Resource and workload planning",
      body: "Workload charts, effort allocation and job roles help large teams balance people across many projects.",
    },
    {
      title: "Proofing and approvals",
      body: "Creative teams can review and approve assets inside Wrike, with markup on images and video.",
    },
    {
      title: "Request workflows",
      body: "Dynamic request forms route incoming work to the right project with the right fields filled in.",
    },
  ],
  different: [
    {
      title: "Adopted in a day",
      body: "A Margaya project starts as a board with a capture bar. Gantt, cycles, intake and time tracking switch on per project when a team wants them.",
    },
    {
      title: "Everything in every edition",
      body: "Self-hosted Margaya includes every feature: custom fields, time tracking, analytics, the audit log and OIDC single sign-on.",
    },
    {
      title: "Your infrastructure",
      body: "Run Margaya with Docker or Helm next to your other services, under the MIT licence, with PostgreSQL holding your data.",
    },
  ],
  migration:
    "Wrike exports tasks to Excel from table views. Save the sheet as CSV, then map titles, statuses, assignees, dates and descriptions in Margaya's CSV import, and review the rows before importing.",
  faq: [
    {
      question: "Does Margaya have a Gantt chart like Wrike?",
      answer:
        "Yes. The Gantt layout draws each dated task as a bar and connects blocking and ordering relations with lines that turn red when the dates conflict.",
    },
    {
      question: "Does Margaya do resource management?",
      answer:
        "Not in the way Wrike does. Margaya has estimates, time tracking and analytics by assignee, but no capacity planning or job roles.",
    },
    {
      question: "Can Margaya collect requests like Wrike forms?",
      answer:
        "Margaya's intake queue collects requests for review, and a public board can let signed-in visitors submit them. There is no custom form builder.",
    },
  ],
  related: ["asana", "monday", "openproject", "clickup"],
  screenshot: "gantt",
  reviewedOn: "2026-10-15",
};
