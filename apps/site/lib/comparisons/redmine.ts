import type { Comparison } from "./types";

export const redmine: Comparison = {
  slug: "redmine",
  competitor: "Redmine",
  categories: ["issue-tracker", "open-source"],
  title: "Margaya vs Redmine: a modern open-source Redmine alternative",
  description:
    "Compare Margaya and Redmine: a modern, self-hosted tracker with boards, Gantt, cycles, intake and live docs built in instead of assembled from plugins.",
  summary:
    "The self-hosted tracker you know, with a modern interface and planning built in rather than plugged in.",
  verdict:
    "Choose Redmine if you run it well today and depend on its plugin ecosystem; choose Margaya for a modern interface where boards, cycles, docs and live updates come built in.",
  glance: {
    hosting: "Self-host; third-party hosting available",
    licence: "GPLv2",
    pricing: "Free",
    bestFor: "Teams that know Redmine well and rely on its plugins",
    margayaBestFor:
      "Teams that want a modern self-hosted tracker without assembling plugins",
  },
  them: {
    cycles: ["partial", "Versions, or Agile plugins"],
    modules: ["partial", "Versions and parent issues"],
    estimates: ["yes", "Estimated time"],
    customFields: "yes",
    timeTracking: ["yes", "Spent time and reports"],
    relations: ["yes", "Subtasks and issue relations"],
    board: ["partial", "Through plugins"],
    list: ["yes", "Issue list"],
    calendar: "yes",
    gantt: "yes",
    savedViews: ["yes", "Saved queries"],
    pages: ["yes", "Wiki"],
    coEditing: "no",
    intake: ["partial", "Incoming email"],
    inbox: ["partial", "Email notifications"],
    publicBoards: ["yes", "Public projects"],
    automations: ["partial", "Workflows by role and tracker"],
    api: "yes",
    aiAssistant: ["partial", "Through third-party plugins"],
    mcp: ["no", "Not built in"],
    integrations: ["partial", "Repositories and plugins"],
    openSource: ["yes", "GPLv2"],
    selfHost: "yes",
    sso: ["partial", "LDAP built in, others by plugin"],
    auditLog: ["partial", "Journals per issue"],
    freeSelfHost: "yes",
    managedCloud: ["partial", "Third-party hosts"],
    allFeatures: "yes",
  },
  shines: [
    {
      title: "Proven over many years",
      body: "Redmine has run issue tracking for countless teams and organisations, and its behaviour is well understood.",
    },
    {
      title: "Plugins for almost everything",
      body: "A large plugin ecosystem adds agile boards, helpdesks, checklists and more, so an experienced admin can tailor it closely.",
    },
    {
      title: "Built-in time and Gantt",
      body: "Time tracking, Gantt charts, a calendar, a wiki and repository browsing come out of the box.",
    },
  ],
  different: [
    {
      title: "Planning built in",
      body: "Boards, cycles with burndown, modules, estimates, intake and saved views are part of Margaya, with no plugins to keep compatible across upgrades.",
    },
    {
      title: "Live and collaborative",
      body: "Board changes arrive instantly over WebSockets, and project pages support live co-editing with cursors and version history.",
    },
    {
      title: "Modern operations",
      body: "Margaya ships as one container with PostgreSQL, upgrades through migrations that respect existing data, and deploys with Docker Compose or Helm.",
    },
  ],
  migration:
    "Redmine exports any issue list as CSV. Import the file into a Margaya project and map tracker, status, assignee, priority, dates and estimated time to Margaya fields before you confirm.",
  faq: [
    {
      question: "Is Margaya a good modern replacement for Redmine?",
      answer:
        "For teams that use Redmine as an issue tracker with boards, time tracking and a Gantt, yes. If you rely on specific Redmine plugins, check that Margaya covers that need first.",
    },
    {
      question: "Does Margaya support LDAP?",
      answer:
        "Margaya signs people in with email and password, Google, GitHub, Discord or any OpenID Connect provider. Directories such as Active Directory usually connect through an OIDC provider.",
    },
    {
      question: "Are both tools free?",
      answer:
        "Yes. Redmine is GPLv2 and Margaya is MIT licensed, and both are free to self-host. Margaya also offers a managed cloud.",
    },
  ],
  related: ["openproject", "taiga", "kanboard", "jira"],
  screenshot: "list",
  reviewedOn: "2026-10-15",
};
