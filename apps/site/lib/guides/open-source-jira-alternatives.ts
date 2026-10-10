import { alternativePath } from "@/lib/comparisons/types";
import type { Guide } from "./types";

export const openSourceJiraAlternatives: Guide = {
  slug: "open-source-jira-alternatives",
  question: "Which open-source tools can replace Jira?",
  title: "Open-source Jira alternatives, and how to move your issues across",
  description:
    "The open-source trackers that can replace Jira, with a fair note on each, followed by a step-by-step move of a Jira project into Margaya: statuses, people, sub-tasks, links, comments and sprints.",
  summary:
    "Four open-source trackers compared fairly, then a step-by-step Jira import with sprints, sub-tasks and comments.",
  answer:
    "OpenProject is closest to Jira's structure, Redmine is the longest-lived, Taiga is built for Scrum, and Margaya is the lightest to work in day to day while keeping sprints, a backlog and Gantt planning. All four can run on your own servers. Margaya's importer reads Jira's CSV export directly, with statuses, people, sub-tasks, links, comments and sprints.",
  topic: "choose",
  timeNeeded: "40 minutes",
  before: [
    "Permission to export issues from your Jira project",
    "A Margaya workspace where you can create projects and tasks",
  ],
  sections: [
    {
      heading: "The open-source options",
      body: [
        "Each of these is open source and can run on infrastructure you control. They differ mainly in how much structure they bring with them.",
      ],
      items: [
        {
          name: "OpenProject",
          href: alternativePath("openproject"),
          meta: "Closest to Jira's structure",
          body: "Work package hierarchies, Gantt charts with baselines, time and cost tracking, meetings and a wiki. Some capabilities are kept for its paid Enterprise edition.",
        },
        {
          name: "Redmine",
          href: alternativePath("redmine"),
          meta: "Longest-lived",
          body: "A dependable tracker with many projects, time logging, a wiki and a large plugin ecosystem. The interface shows its age, and plugins need care across upgrades.",
        },
        {
          name: "Taiga",
          href: alternativePath("taiga"),
          meta: "Built for Scrum",
          body: "Epics, user stories, sprints, story points and burndown charts in a clean interface. Narrower if your work isn't agile software delivery.",
        },
        {
          name: "Margaya",
          href: alternativePath("jira"),
          meta: "Lightest day to day",
          body: "Board, list, backlog, spreadsheet, calendar and Gantt over the same tasks, with cycles, modules, estimates and intake switched on per project. Imports Jira's CSV export directly. MIT licensed. We build it.",
        },
      ],
    },
    {
      heading: "Move a Jira project to Margaya",
      body: [
        "The importer works from Jira's CSV file alone. It never connects to your Jira site and doesn't need a Jira account or API token.",
      ],
      steps: [
        {
          title: "Prepare the project",
          body: [
            "Create the Margaya project, then open Settings > Projects > your project > Features and switch on what the import should fill in. Cycles takes Jira sprints, Modules takes components, and Estimates takes story points or original estimates.",
            "In the Workflow tab, create the columns you want to work with. You'll map each Jira status to one of them in a moment, so they don't need to match Jira one to one.",
          ],
        },
        {
          title: "Invite the team",
          body: [
            "Assignees and reporters are matched to workspace members by email, then by exact name. Invite people in Settings > Members first, so their tasks arrive assigned.",
          ],
        },
        {
          title: "Export from Jira",
          body: [
            "In Jira, open Filters > View all issues and filter to the project, for example `project = WEB`. Choose Export > Export CSV (all fields).",
          ],
          callout: {
            tone: "warning",
            title: "Don't open and re-save the file",
            body: "Saving the CSV from a spreadsheet app can change its dates and separators. Upload the file exactly as Jira produced it.",
          },
        },
        {
          title: "Upload and map",
          body: [
            "Open Settings > Projects > your project > General. In Tasks import/export, choose Import, then Jira (CSV export), and upload the file. Margaya shows how many issues it holds and the columns it found.",
            "In the mapping step, pick the column each Jira status goes to. Suggestions come from the status name, then from Jira's status category, and anything can go to the backlog. Check the priority mapping too: Highest becomes Urgent, High stays High, Medium stays Medium, and Low and Lowest become Low.",
          ],
        },
        {
          title: "Choose the options",
          body: ["Four options decide what comes along with each issue:"],
          bullets: [
            "Add the issue type as a label (on by default): Bug, Story and so on become labels.",
            "Import comments (on by default): comments arrive with their Jira author's name and date, and notify nobody.",
            "Put sprints in cycles: each issue goes into a cycle named after its last sprint. Missing cycles are created without dates.",
            "Put components in modules: each issue joins modules named after its components.",
          ],
        },
        {
          title: "Import and read the summary",
          body: [
            "Choose Import. The summary lists tasks created, updated and skipped, comments and relations added, people who didn't match a member, warnings, and any rows that failed, with their line numbers. Each issue imports on its own, so one bad row doesn't stop the rest.",
            "Descriptions are converted from Jira's wiki markup to Markdown. Sub-tasks keep their parent, and Blocks, Relates and Duplicate links become task relations when both issues are in the file.",
          ],
          callout: {
            tone: "note",
            title: "Attachments stay in Jira",
            body: "They aren't downloaded. Their names and links are added to the end of each description, so keep Jira readable until you've copied what you need.",
          },
        },
        {
          title: "Import again, safely",
          body: [
            "Each task remembers its Jira key, and its activity shows where it came from. Import a newer export later and issues already imported are skipped, or updated if you choose. New issues are added, and comments are never duplicated.",
          ],
        },
        {
          title: "Plan the first cycle",
          body: [
            "Give the imported cycles dates, or create a new one for the next sprint. A cycle's status follows its dates, its burndown tracks progress, and Transfer moves unfinished work into the next cycle when it ends.",
          ],
          shot: {
            view: "cycles",
            alt: "Margaya cycles for a project, with an active cycle showing its progress.",
          },
        },
      ],
    },
  ],
  faq: [
    {
      question: "How large a Jira project can I import?",
      answer:
        "Each file holds up to 5 MB and 5,000 issues. Export larger projects in parts, for example by creation date, and import the files one after another. Relations between files are added as the later issues arrive.",
    },
    {
      question: "Do story points come across?",
      answer:
        "Yes, when the project has Estimates switched on and its active estimate system contains that exact value. Otherwise the estimate is skipped and listed as a warning.",
    },
    {
      question: "Can I import Jira's XML export?",
      answer:
        "No. Only the CSV export is supported. Use Export CSV (all fields) for the most complete result.",
    },
    {
      question: "Who can run the import?",
      answer:
        "Anyone who can create tasks in the project. Updating issues imported before needs permission to update tasks, and importing comments with their Jira authors needs the Manage workspace settings permission.",
    },
  ],
  next: [
    {
      label: "Jira import reference",
      href: "/docs/core/functional/import-from-jira",
      description: "The full field mapping, options and limits.",
    },
    {
      label: "Jira alternatives compared",
      href: "/blog/best-jira-alternatives",
      description: "Hosted and open-source picks, and who each one suits.",
    },
    {
      label: "Plan work in cycles",
      href: "/docs/core/functional/cycles",
      description: "Dates, burndown, transfer and archiving.",
    },
  ],
  updatedOn: "2026-10-15",
};
