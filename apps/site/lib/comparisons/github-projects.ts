import type { Comparison } from "./types";

export const githubProjects: Comparison = {
  slug: "github-projects",
  competitor: "GitHub Projects",
  categories: ["issue-tracker"],
  title: "Margaya vs GitHub Projects: planning beyond the repository",
  description:
    "Compare Margaya and GitHub Projects: cycles, modules, intake, docs and time tracking for the whole team, with GitHub sync, MIT licensed and self-hostable.",
  summary:
    "Planning for the whole team, linked to GitHub but not limited to it.",
  verdict:
    "Choose GitHub Projects when all of your work is code in GitHub repositories; choose Margaya when planning includes people and work that do not live in a repository.",
  glance: {
    hosting: "GitHub.com, or GitHub Enterprise Server",
    licence: "Proprietary",
    pricing: "Included with GitHub plans",
    bestFor: "Engineering teams whose work is all issues and pull requests",
    margayaBestFor:
      "Teams that plan more than code and want one board for engineers and everyone else",
  },
  them: {
    cycles: ["yes", "Iteration fields"],
    modules: ["partial", "Milestones and sub-issues"],
    estimates: ["partial", "Number fields"],
    customFields: "yes",
    timeTracking: "no",
    relations: ["yes", "Sub-issues and issue relationships"],
    board: "yes",
    list: ["yes", "Table layout"],
    calendar: "no",
    gantt: ["yes", "Roadmap layout"],
    savedViews: "yes",
    pages: ["partial", "Repository wikis and Markdown"],
    coEditing: "no",
    intake: ["partial", "Issue forms in repositories"],
    inbox: "yes",
    publicBoards: ["yes", "Public projects"],
    automations: ["yes", "Built-in workflows and Actions"],
    api: ["yes", "GraphQL API and webhooks"],
    aiAssistant: ["yes", "GitHub Copilot, free tier and paid plans"],
    mcp: ["yes", "GitHub MCP server"],
    integrations: ["yes", "GitHub Marketplace"],
    openSource: "no",
    selfHost: ["partial", "GitHub Enterprise Server"],
    sso: ["partial", "Enterprise plans"],
    auditLog: ["partial", "More detail on Enterprise"],
    freeSelfHost: "no",
    managedCloud: "yes",
    allFeatures: ["partial", "Included; admin features by plan"],
  },
  shines: [
    {
      title: "Right next to the code",
      body: "Issues and pull requests are the items on the board, so status changes as code is reviewed and merged without any syncing.",
    },
    {
      title: "Already paid for",
      body: "Projects come with GitHub, so a team already on GitHub gets planning without another subscription or account.",
    },
    {
      title: "Open-source friendly",
      body: "Public projects let maintainers share roadmaps with contributors who already have GitHub accounts.",
    },
  ],
  different: [
    {
      title: "A home for non-code work",
      body: "Design, marketing, support and operations tasks live alongside engineering work, with intake, pages and time tracking for everyone.",
    },
    {
      title: "Connected, not dependent",
      body: "Link GitHub repositories to Margaya projects: issues sync with tasks, pull requests show on tasks, and workflow rules move tasks when a pull request opens or merges. Gitea works too.",
    },
    {
      title: "Planning built in",
      body: "Cycles with burndown charts, modules with progress, estimates and a Gantt with dependency lines are part of the product rather than fields you set up.",
    },
  ],
  migration:
    "Connect the repository through Margaya's GitHub integration to bring issues in as tasks. For project items that are not issues, export the project's table view as CSV and use the CSV import.",
  faq: [
    {
      question: "Does Margaya sync with GitHub issues?",
      answer:
        "Yes. The GitHub integration links a repository to a project, keeps tasks and issues in step, shows related pull requests on tasks, and can move tasks through workflow rules.",
    },
    {
      question: "Why use Margaya if GitHub Projects is included?",
      answer:
        "When planning includes people who do not work in repositories, or when you need intake, docs, time tracking or a Gantt with dependencies in one place.",
    },
    {
      question: "Is Margaya open source?",
      answer:
        "Yes, under the MIT licence. You can self-host it for free with Docker or Helm, or use Margaya Cloud.",
    },
  ],
  related: ["linear", "jira", "azure-devops", "shortcut"],
  screenshot: "board",
  reviewedOn: "2026-10-15",
};
