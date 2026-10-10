import type { Comparison } from "./types";

export const openproject: Comparison = {
  slug: "openproject",
  competitor: "OpenProject",
  categories: ["issue-tracker", "open-source"],
  title: "Margaya vs OpenProject: a lighter open-source alternative",
  description:
    "Compare Margaya and OpenProject: two self-hosted project tools. Margaya is MIT licensed, one container plus PostgreSQL, with every feature in every install.",
  summary:
    "Gantt, cycles and time tracking in a smaller self-hosted setup, MIT licensed with nothing held back.",
  verdict:
    "Choose OpenProject for classic project management with budgets, baselines and deep hierarchies; choose Margaya for a faster, smaller tool that covers modern team planning with every feature free.",
  glance: {
    hosting: "Self-host, or OpenProject's cloud",
    licence: "GPLv3 Community edition, plus Enterprise add-ons",
    pricing: "Community free; Enterprise per-user",
    bestFor:
      "Formal project management with budgets, baselines and PMO reporting",
    margayaBestFor:
      "Teams that want agile planning and a Gantt in a smaller, faster tool",
  },
  them: {
    cycles: ["yes", "Backlogs and sprints"],
    modules: ["yes", "Epics, phases and versions"],
    estimates: ["yes", "Story points and hours"],
    customFields: "yes",
    timeTracking: ["yes", "Time and cost reporting"],
    relations: ["yes", "Hierarchies and relations"],
    board: ["partial", "Some board types in Enterprise"],
    list: ["yes", "Work package table"],
    calendar: "yes",
    gantt: ["yes", "With baselines"],
    savedViews: "yes",
    pages: ["yes", "Wiki"],
    coEditing: ["partial", "Wiki pages"],
    intake: ["partial", "Incoming email"],
    inbox: ["yes", "Notification centre"],
    publicBoards: ["yes", "Public projects"],
    automations: ["partial", "Workflows by role and type"],
    api: ["yes", "REST API and webhooks"],
    mcp: ["partial", "Community servers"],
    integrations: ["yes", "GitHub, GitLab, Nextcloud and more"],
    openSource: ["yes", "GPLv3"],
    selfHost: "yes",
    sso: ["partial", "Some providers need Enterprise"],
    auditLog: ["partial", "Activity history"],
    freeSelfHost: ["yes", "Community edition"],
    managedCloud: "yes",
    allFeatures: ["no", "Enterprise add-ons"],
  },
  shines: [
    {
      title: "Classic project controls",
      body: "Budgets, cost reporting, baselines and work-package hierarchies give PMOs the controls they expect from traditional project management.",
    },
    {
      title: "A long track record",
      body: "OpenProject has been developed in the open for many years and is used by public bodies and large organisations that require on-premises software.",
    },
    {
      title: "Wide integrations",
      body: "Nextcloud, GitLab, GitHub and LDAP integrations fit naturally into self-hosted office stacks.",
    },
  ],
  different: [
    {
      title: "Small to run",
      body: "Margaya is one application container plus PostgreSQL. Redis is optional, and a Helm chart covers Kubernetes.",
    },
    {
      title: "Nothing held back",
      body: "Every feature, including boards, single sign-on, the audit log and analytics, is part of the MIT-licensed code. There is no enterprise edition.",
    },
    {
      title: "Fast, modern interface",
      body: "A capture bar, keyboard shortcuts, live updates over WebSockets and live co-edited pages make routine work quick.",
    },
  ],
  migration:
    "Export work packages from an OpenProject table view as CSV. Import the file into a Margaya project and map type, status, assignee, priority and dates; the review step shows anything that does not match.",
  faq: [
    {
      question: "Which is easier to self-host, Margaya or OpenProject?",
      answer:
        "Margaya runs as a single application container next to PostgreSQL, with an optional Redis for multiple API instances. Both projects provide Docker setups and Helm charts.",
    },
    {
      question: "Does Margaya have budgets or cost reporting?",
      answer:
        "No. Margaya tracks estimates and time entries and reports on them in analytics, but it has no budgets, cost rates or baselines.",
    },
    {
      question: "Is Margaya fully open source?",
      answer:
        "Yes. All of Margaya is MIT licensed, with no enterprise edition and no features reserved for a commercial licence. Margaya Cloud is the same product as a managed service.",
    },
  ],
  related: ["redmine", "taiga", "jira", "leantime"],
  screenshot: "gantt",
  reviewedOn: "2026-10-15",
};
