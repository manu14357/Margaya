import type { Comparison } from "./types";

export const azureDevops: Comparison = {
  slug: "azure-devops",
  competitor: "Azure DevOps",
  categories: ["issue-tracker"],
  title: "Margaya vs Azure DevOps Boards: an open-source alternative",
  description:
    "Compare Margaya and Azure DevOps Boards: sprints, epics, Gantt and docs in an MIT-licensed tracker that works with any Git host and is free to self-host.",
  summary:
    "Sprints, epics and planning views that are not tied to one vendor's toolchain.",
  verdict:
    "Choose Azure DevOps when repos, pipelines and test plans already live there; choose Margaya for planning that is independent of your toolchain and lighter for non-engineers.",
  glance: {
    hosting: "Microsoft cloud, or Azure DevOps Server on-premises",
    licence: "Proprietary",
    pricing: "Free for small teams, then paid per-user access",
    bestFor: "Organisations standardised on Microsoft and Azure",
    margayaBestFor:
      "Teams that want planning separate from their CI and Git host",
  },
  them: {
    cycles: ["yes", "Sprints"],
    modules: ["yes", "Epics and features"],
    estimates: "yes",
    customFields: ["yes", "Through process customisation"],
    timeTracking: ["partial", "Remaining-work fields or extensions"],
    relations: "yes",
    board: "yes",
    list: ["yes", "Backlogs and queries"],
    calendar: ["partial", "Through extensions"],
    gantt: ["partial", "Delivery Plans or extensions"],
    savedViews: ["yes", "Shared queries"],
    pages: ["yes", "Project wiki"],
    coEditing: ["partial", "Wiki pages"],
    intake: ["partial", "Through extensions"],
    inbox: ["partial", "Email notifications"],
    publicBoards: ["yes", "Public projects"],
    automations: ["yes", "Rules and Azure Pipelines"],
    api: "yes",
    mcp: ["yes", "Azure DevOps MCP server"],
    integrations: "yes",
    openSource: "no",
    selfHost: ["yes", "Azure DevOps Server"],
    sso: ["yes", "Microsoft Entra ID"],
    auditLog: "yes",
    freeSelfHost: ["partial", "Free for small teams"],
    managedCloud: "yes",
    allFeatures: ["partial", "Some features need paid access levels"],
  },
  shines: [
    {
      title: "The whole delivery pipeline",
      body: "Boards, Repos, Pipelines, Test Plans and Artifacts in one service mean work items, code, builds and tests share the same links and permissions.",
    },
    {
      title: "Enterprise identity",
      body: "Microsoft Entra ID, conditional access and organisation policies fit straight into existing Microsoft governance.",
    },
    {
      title: "Process templates",
      body: "Agile, Scrum and CMMI templates, with inherited process customisation, suit teams with formal delivery processes.",
    },
  ],
  different: [
    {
      title: "Independent of your Git host",
      body: "Margaya connects to GitHub and Gitea, and to anything else through signed webhooks, the REST API and MCP. Move repositories without moving your plan.",
    },
    {
      title: "Friendly to the whole team",
      body: "Designers, support and product people get a board, a capture bar, a calendar and project pages without learning a work-item query language.",
    },
    {
      title: "Open and portable",
      body: "MIT licensed, self-hosted with Docker or Helm, OIDC single sign-on with any provider (Entra ID included), and CSV or JSON export for every project.",
    },
  ],
  migration:
    "Run a query in Azure Boards and export the results to CSV. Import the file into a Margaya project and map states, assigned people, tags, priorities and dates to Margaya fields.",
  faq: [
    {
      question: "Can Margaya use Microsoft Entra ID for sign-in?",
      answer:
        "Yes. Margaya supports any OpenID Connect provider, which includes Microsoft Entra ID, on every self-hosted installation.",
    },
    {
      question: "Does Margaya have CI or repositories?",
      answer:
        "No. Margaya is a planning tool. It links tasks to pull requests and issues on GitHub or Gitea, and leaves builds and code hosting to the tools you already use.",
    },
    {
      question: "Does Margaya support sprints and epics?",
      answer:
        "Yes. Cycles are time-boxed iterations with burndown and carryover, and modules group the tasks of an epic or feature with progress tracking.",
    },
  ],
  related: ["jira", "github-projects", "youtrack", "openproject"],
  screenshot: "cycles",
  reviewedOn: "2026-10-15",
};
