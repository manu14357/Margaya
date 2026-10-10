import { alternativePath } from "@/lib/comparisons/types";
import type { Guide } from "./types";

export const bestOpenSourceProjectManagement: Guide = {
  slug: "best-open-source-project-management-software",
  question: "How do I pick open-source project management software?",
  title: "How to choose open-source project management software",
  description:
    "A fair shortlist of open-source project management tools in 2026, what their licences really give you, and a one-afternoon trial plan to find the right one for your team.",
  summary:
    "A fair shortlist, what each licence really gives you, and a trial plan that fits in one afternoon.",
  answer:
    "There's no single best. It depends on how much structure you need and who will run the server. OpenProject suits plan-driven projects with Gantt charts and costs. Redmine is a long-lived issue tracker. Taiga is built for Scrum. WeKan and Kanboard are simple boards, and Vikunja suits personal and small-team lists. Margaya suits teams who want boards, sprints, docs and imports in one light tool. Run a one-afternoon trial before you decide.",
  topic: "choose",
  timeNeeded: "One afternoon",
  sections: [
    {
      heading: "What open source actually gets you",
      body: [
        "An open-source licence lets you read the code, run it wherever you like and keep running it if the company behind it changes course. That's the real benefit: no vendor can switch off your planning tool.",
        "Licences differ. Permissive licences such as MIT let you do almost anything with the code. Copyleft licences such as the GPL and AGPL require changes you distribute, or in the AGPL's case serve over a network, to be shared under the same terms. Some projects are open core, with certain features kept for a paid edition.",
        "Before you commit, check two things: the licence itself, and whether the features you need are in the free edition. Margaya is MIT licensed, and its self-hosted build has every feature, single sign-on included.",
      ],
    },
    {
      heading: "The shortlist",
      items: [
        {
          name: "Margaya",
          meta: "MIT · boards, sprints, docs and imports",
          body: "Board, list, backlog, spreadsheet, calendar and Gantt views over the same tasks. Cycles, modules, estimates, intake and time tracking are switched on per project. Pages for docs, Jira and CSV import, a REST API and an MCP server. We build it.",
        },
        {
          name: "OpenProject",
          href: alternativePath("openproject"),
          meta: "Plan-driven projects",
          body: "Work packages, Gantt charts with baselines, time and costs, meetings and a wiki. Strong for formal project management. Some capabilities are in the paid Enterprise edition.",
        },
        {
          name: "Redmine",
          href: alternativePath("redmine"),
          meta: "Long-lived issue tracking",
          body: "Mature and stable, with many projects, time logging, a wiki and a large plugin ecosystem. The interface is dated.",
        },
        {
          name: "Taiga",
          href: alternativePath("taiga"),
          meta: "Scrum and Kanban",
          body: "Epics, user stories, sprints and burndowns in a tidy interface. Best for agile software teams.",
        },
        {
          name: "Huly",
          href: alternativePath("huly"),
          meta: "All-in-one workspace",
          body: "Issue tracking alongside docs, chat and meetings. Appealing if you want to replace several tools at once, but heavier to run.",
        },
        {
          name: "Leantime",
          href: alternativePath("leantime"),
          meta: "For people who aren't project managers",
          body: "Combines strategy, goals and tasks, with an emphasis on being approachable.",
        },
        {
          name: "Vikunja",
          href: alternativePath("vikunja"),
          meta: "Personal and small-team lists",
          body: "A light task manager with list, Kanban, Gantt and table views.",
        },
        {
          name: "WeKan and Kanboard",
          href: alternativePath("wekan"),
          meta: "Simple boards",
          body: "WeKan feels like Trello. Kanboard is minimal and very light. Both are good when a board is all you need.",
        },
      ],
    },
    {
      heading: "Trial it in one afternoon",
      body: [
        "The steps use Margaya as the example, but the same trial works for any tool on the list. Run it for your top two candidates.",
      ],
      steps: [
        {
          title: "Write down three must-haves",
          body: [
            "Not ten. Three. For example: sprints with carry-over, single sign-on with our identity provider, and a calendar of due dates. Anything that fails one of the three is out, however good the rest looks.",
          ],
        },
        {
          title: "Start a test instance",
          body: [
            "Most of these tools ship a Docker Compose file. For Margaya, create compose.yml and .env as described in the Docker guide, then start it. On a laptop, `MARGAYA_CLIENT_URL` can simply be `http://localhost:5173`.",
          ],
          code: {
            label: "Terminal",
            content: `docker compose up -d
docker compose ps`,
          },
        },
        {
          title: "Import real work",
          body: [
            "A tool always looks good with demo data. Import a real project instead. Margaya reads Jira's CSV export directly, and any other tool's CSV through a column-mapping import with a review step.",
          ],
        },
        {
          title: "Do an hour of normal work in it",
          body: [
            "Capture tasks in a meeting, move them across the board, find something from last week, hand a task to someone else. In Margaya, try the capture bar on the board (`Plan launch email @ana !high fri`) and the command bar (`Ctrl K`).",
          ],
          shot: {
            view: "board",
            alt: "A Margaya board with imported tasks in workflow columns.",
          },
        },
        {
          title: "Check the way out",
          body: [
            "The best time to check you can leave is before you arrive. Look for full exports, a documented API and a database you can back up with standard tools.",
          ],
          bullets: [
            "Margaya exports tasks to CSV, Excel or JSON from Settings > Workspace > Exports.",
            "Its REST API is described with OpenAPI, and API keys belong to a person and carry their permissions.",
            "All data lives in PostgreSQL, which you can back up with `pg_dump`.",
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: "Is open-source project management software really free?",
      answer:
        "The licence is free. Running it costs a server and some of someone's time for updates and backups. Many projects also sell a hosted version, which is worth it if nobody wants to run the server.",
    },
    {
      question: "Which open-source tools include single sign-on for free?",
      answer:
        "It varies, and it's worth checking edition by edition. In Margaya, sign-in with Google, GitHub, Discord or any OpenID Connect provider is part of every install.",
    },
    {
      question: "Is open-source software safe for business data?",
      answer:
        "It can be safer, because you choose where the data lives and who can reach it. The responsibility for updates, backups and access is yours, though, so treat the server like any other production system.",
    },
    {
      question: "Can I switch tools later?",
      answer:
        "Yes, if you choose a tool with good exports and an API. Check the exit before you commit, as in the last step above.",
    },
  ],
  next: [
    {
      label: "Self-host with Docker Compose",
      href: "/guides/self-host-project-management-docker",
      description: "A working setup, from an empty server to HTTPS.",
    },
    {
      label: "Open-source Jira alternatives",
      href: "/guides/open-source-jira-alternatives",
      description: "Compare the options and move a Jira project across.",
    },
    {
      label: "All comparisons",
      href: "/alternatives",
      description:
        "Margaya side by side with the tools teams weigh it against.",
    },
  ],
  updatedOn: "2026-10-15",
};
