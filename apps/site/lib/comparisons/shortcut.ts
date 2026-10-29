import type { Comparison } from "./types";

export const shortcut: Comparison = {
  slug: "shortcut",
  competitor: "Shortcut",
  categories: ["issue-tracker"],
  title: "Margaya vs Shortcut: a self-hosted Shortcut alternative",
  description:
    "Compare Margaya and Shortcut: iterations, epics, docs and Git integrations, plus Gantt, intake and time tracking in an MIT tool that you can self-host.",
  summary:
    "Cycles, modules and Git integrations for software teams, on your own servers if you like.",
  verdict:
    "Choose Shortcut for a mature cloud workflow built around stories, epics and objectives; choose Margaya for the same rhythm with a Gantt, intake and time tracking, under an open licence.",
  glance: {
    hosting: "Cloud only",
    licence: "Proprietary",
    pricing: "Free plan, then paid per-user plans",
    bestFor: "Software teams that like a story-and-epic workflow in the cloud",
    margayaBestFor:
      "Software teams that want iterations and epics with self-hosting and more views",
  },
  them: {
    cycles: ["yes", "Iterations"],
    modules: ["yes", "Epics, milestones and objectives"],
    estimates: ["yes", "Story points"],
    customFields: "yes",
    timeTracking: "no",
    relations: ["yes", "Sub-tasks and story links"],
    board: "yes",
    list: "yes",
    calendar: "no",
    gantt: ["partial", "Roadmap view"],
    savedViews: "yes",
    pages: ["yes", "Docs"],
    coEditing: "yes",
    intake: ["partial", "Through integrations"],
    inbox: "yes",
    publicBoards: "no",
    automations: ["partial", "Git-driven workflow updates"],
    api: "yes",
    aiAssistant: ["partial", "Korey, a separate AI agent from Shortcut"],
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
      title: "Made for software teams",
      body: "Stories, epics, iterations and objectives fit together naturally, and the Git integrations keep stories in step with branches and pull requests.",
    },
    {
      title: "Reports managers use",
      body: "Velocity, cycle time and burndown reports give engineering managers a steady read on delivery.",
    },
    {
      title: "Docs connected to stories",
      body: "Shortcut Docs sit inside the tracker, so specs and the stories they create stay linked.",
    },
  ],
  different: [
    {
      title: "Open source and self-hostable",
      body: "Margaya is MIT licensed. Run it on your own infrastructure with Docker or Helm, or use Margaya Cloud.",
    },
    {
      title: "More ways to plan",
      body: "A calendar and a Gantt timeline with dependency lines sit beside the board, list and spreadsheet, and time tracking is built in.",
    },
    {
      title: "Git on both sides",
      body: "Connect GitHub or Gitea to link branches and pull requests to tasks, and let workflow rules move tasks when code changes.",
    },
  ],
  migration:
    "Shortcut exports stories as CSV. Import the file into a Margaya project and map workflow states to columns, owners to members, and estimates, labels and dates to Margaya fields.",
  faq: [
    {
      question: "Does Margaya have iterations and epics?",
      answer:
        "Yes. Cycles are Margaya's iterations, with burndown and carryover, and modules group the tasks of an epic with a lead, members and progress.",
    },
    {
      question: "Which Git hosts does Margaya integrate with?",
      answer:
        "GitHub and Gitea. Pull requests and issues link to tasks, and workflow rules can move a task when its pull request is opened or merged.",
    },
    {
      question: "Can I run Margaya on my own servers?",
      answer:
        "Yes, with Docker Compose or Helm. It needs PostgreSQL; Redis is optional for running several API instances.",
    },
  ],
  related: ["linear", "jira", "github-projects", "youtrack"],
  screenshot: "cycles",
  reviewedOn: "2026-10-15",
};
