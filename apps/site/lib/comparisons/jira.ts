import type { Comparison } from "./types";

export const jira: Comparison = {
  slug: "jira",
  competitor: "Jira",
  categories: ["issue-tracker"],
  title: "Margaya vs Jira: an open-source Jira alternative",
  description:
    "Compare Margaya and Jira: cycles, modules, intake, Gantt and docs in an MIT-licensed tracker you can self-host free, with a built-in Jira CSV import.",
  summary:
    "Sprints, epics and a timeline without the configuration layer. MIT licensed, with a Jira CSV import.",
  verdict:
    "Choose Jira for deep enterprise configuration and its marketplace; choose Margaya for the same core planning in an open-source tool your team can run and learn in an afternoon.",
  glance: {
    hosting: "Atlassian Cloud, or Data Center on a paid licence",
    licence: "Proprietary",
    pricing: "Free tier for small teams, then paid per-user plans",
    bestFor:
      "Large organisations that need custom schemes and marketplace apps",
    margayaBestFor:
      "Teams that want sprints, epics and a timeline without a Jira administrator",
  },
  them: {
    cycles: ["yes", "Scrum sprints with reports"],
    modules: ["yes", "Epics"],
    estimates: ["yes", "Story points or time"],
    customFields: "yes",
    timeTracking: "yes",
    relations: ["yes", "Sub-tasks and issue links"],
    board: "yes",
    list: "yes",
    calendar: "yes",
    gantt: ["yes", "Timeline; cross-project plans on higher plans"],
    savedViews: ["yes", "Saved JQL filters"],
    pages: ["partial", "In Confluence, a separate product"],
    coEditing: ["partial", "In Confluence"],
    intake: ["partial", "Forms, or Jira Service Management"],
    inbox: "yes",
    publicBoards: ["partial", "Possible through permission settings"],
    automations: ["yes", "Rule builder, with run limits by plan"],
    api: "yes",
    mcp: ["yes", "Atlassian's hosted MCP server"],
    integrations: ["yes", "Large app marketplace"],
    openSource: "no",
    selfHost: ["partial", "Data Center, paid"],
    sso: ["partial", "With Atlassian Guard or Enterprise"],
    auditLog: ["partial", "On paid plans"],
    freeSelfHost: "no",
    managedCloud: "yes",
    allFeatures: ["no", "Features tiered by plan"],
  },
  shines: [
    {
      title: "Configuration for any process",
      body: "Issue types, workflows, screens and permission schemes can be shaped to match almost any organisation, and Jira administrators know how to do it.",
    },
    {
      title: "A huge ecosystem",
      body: "The Atlassian Marketplace covers test management, portfolio planning, compliance and countless niche integrations that no smaller tool can match.",
    },
    {
      title: "Reporting at scale",
      body: "Velocity, control charts and cross-project plans give large programmes the roll-ups that executives expect.",
    },
  ],
  different: [
    {
      title: "Planning features stay out of the way",
      body: "Cycles, modules, estimates and intake are switched on per project. A team that only needs a board never sees them, and adding a task is one line in the capture bar.",
    },
    {
      title: "You can own the whole thing",
      body: "Margaya is MIT licensed and runs as one container plus PostgreSQL, or on Kubernetes with the Helm chart. Self-hosting is free, with every feature, OIDC single sign-on included.",
    },
    {
      title: "Docs and tasks in one place",
      body: "Every project has a page tree with live co-editing and version history, so specs live next to the tasks they describe instead of in a second product.",
    },
  ],
  migration:
    "Margaya imports Jira's own CSV export. Pick where each Jira status lands, match people to members, and optionally turn sprints into cycles and components into modules. Sub-tasks, issue links and comments come along.",
  faq: [
    {
      question: "Is Margaya a free alternative to Jira?",
      answer:
        "Self-hosting Margaya is free under the MIT licence, with no user limit and no paid-only features. If you would rather not run a server, Margaya Cloud is a managed subscription; see the pricing page for current plans.",
    },
    {
      question: "Does Margaya have sprints and epics?",
      answer:
        "Yes. Cycles are time-boxed iterations with automatic status, a burndown and burn-up chart and carryover of unfinished work. Modules group the tasks of a feature or epic with a lead, members and progress. Both are optional per project.",
    },
    {
      question: "Can I move my Jira project to Margaya?",
      answer:
        "Yes. Export your issues from Jira as CSV and use the Jira import in your project's settings. It maps statuses, priorities and people, keeps sub-tasks, links and comments, and can update issues you imported before.",
    },
    {
      question: "What does Margaya not do that Jira does?",
      answer:
        "Margaya has no configurable issue-type schemes and no app marketplace. Its automation covers When, If, Then rules per project, scheduled cleanup and Git-driven rules, and everything else is open to you through the REST API, webhooks and MCP.",
    },
  ],
  related: ["linear", "youtrack", "openproject", "azure-devops"],
  screenshot: "board",
  reviewedOn: "2026-10-15",
};
