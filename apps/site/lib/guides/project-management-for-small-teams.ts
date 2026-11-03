import type { Guide } from "./types";

export const projectManagementForSmallTeams: Guide = {
  slug: "project-management-for-small-teams",
  question: "What is the simplest project setup that works for a small team?",
  title: "Set up Margaya for a small team in 15 minutes",
  description:
    "A practical setup for teams of two to twenty: one workspace, a few projects, a short workflow, fast task capture, and planning features only when a real problem calls for them.",
  summary:
    "One workspace, a short workflow, fast capture, and a daily routine that takes two minutes.",
  answer:
    "Keep it small. Use one workspace, one project per stream of work, four or five columns, and one owner per task. Capture tasks from the board with the capture bar, start each day in Your work and the inbox, and turn on cycles, intake or estimates only when a real problem calls for them.",
  topic: "start",
  timeNeeded: "15 minutes",
  before: [
    "A Margaya account on a server you or your team run",
    "The email addresses of the people you're inviting",
  ],
  sections: [
    {
      heading: "Find your way around",
      body: [
        "The icon rail on the far left holds the places you go every day: Home, Inbox, Your work, Projects and Pages, plus Analytics if your role can see it. Settings sits at the foot of the rail.",
        "Next to the rail, the context panel lists what belongs to the place you picked, such as your projects, favorites and recent items. Press `Ctrl B` to hide it when you want the whole screen for a board.",
        "`Ctrl K` opens the command bar from anywhere. Type to search, or start with `>` for actions, `#` to find a task by key or title, `@` for people and `/` for places. Press `?` to see every keyboard shortcut. On macOS, use `⌘` instead of `Ctrl`.",
      ],
      shot: {
        view: "home",
        alt: "Margaya Home with the icon rail on the left, the context panel beside it, and the command field at the top.",
        caption:
          "Home: the icon rail, the context panel and the command field.",
      },
    },
    {
      heading: "Set up the workspace",
      steps: [
        {
          title: "Create a project for each stream of work",
          body: [
            "Name the workspace after your team or company. Then create one project for each stream of work, such as Website, Mobile app or Operations. Don't create one per person: ownership belongs on the task, not the project.",
            "Each task gets a short, readable key such as `WEB-12`, which you can paste into chat or search for with `Ctrl K`.",
          ],
        },
        {
          title: "Keep the workflow short",
          body: [
            "Open Settings > Projects > your project > Workflow and trim the columns to the stages work really passes through. Four or five is plenty for most teams, for example Backlog, To do, In progress, Review and Done.",
            "Each column belongs to a group: Backlog, Not started, Started, Completed or Cancelled. Groups, not column names, drive progress, cycle burndown and analytics, so set them correctly once and you won't need to think about them again.",
          ],
          callout: {
            tone: "tip",
            title: "Agree on conventions before you invite people",
            body: "Decide what each priority means, name a few shared labels (bug, feature, chore), and agree that every open task has one owner. Ten minutes now saves weeks of tidying later.",
          },
        },
        {
          title: "Invite the team and pick roles",
          body: [
            "Open Settings > Members and invite people by email. Four roles are built in: Owner, Admin, Member and Viewer. Most people should be Members. Give Viewer to anyone who only needs to follow along or send requests.",
            "If the built-in roles don't fit, admins can create custom roles in Settings > Workspace > Roles.",
          ],
        },
        {
          title: "Capture tasks with the capture bar",
          body: [
            "On the board or the list, press `c` to jump to the capture bar and type a title. A few markers turn into task fields as you type, shown as chips you can remove:",
          ],
          bullets: [
            "`@name` picks an assignee.",
            "`#label` adds a label. A label that doesn't exist yet is created with the task, if your role allows it.",
            "`!priority` sets the priority. The start of the word is enough, so `!h` means high and `!u` means urgent.",
            "Date words set the due date: `today`, `tomorrow`, a weekday such as `fri`, `next week`, or a date such as `12 Oct`.",
          ],
          code: {
            label: "Capture bar",
            content: "Draft pricing FAQ @maya #website !high fri",
          },
          callout: {
            tone: "note",
            title: "Enter, or Ctrl Enter",
            body: "`Enter` creates the task in that column. `Ctrl Enter` opens the full editor with everything you typed already filled in, for when you want to add a description.",
          },
          shot: {
            view: "board",
            alt: "A Margaya project board with columns of task cards and the capture bar at the top of a column.",
          },
        },
        {
          title: "Work from the keyboard",
          body: [
            "In a list or board, `j` and `k` move between tasks and `Enter` opens one. With a task open, single keys open its pickers: `s` for status, `p` for priority, `a` for assignees, `l` for labels and `d` for the due date. `i` assigns the task to you, or unassigns you.",
          ],
          shot: {
            view: "task",
            alt: "An open Margaya task with its properties, description and activity.",
          },
        },
      ],
    },
    {
      heading: "A two-minute daily routine",
      steps: [
        {
          title: "Start in Your work",
          body: [
            "Your work (`g` then `y`) gathers everything assigned to you across every project, with overdue and due-this-week counts at the top. Start there, not on the board.",
          ],
        },
        {
          title: "Clear the inbox",
          body: [
            "The inbox (`n` then `i`) collects assignments, mentions and changes to tasks you follow. Snooze what can wait and archive what's done, so the inbox only holds what still needs you.",
          ],
          shot: {
            view: "inbox",
            alt: "The Margaya inbox listing notifications about assignments, mentions and task changes.",
          },
        },
      ],
    },
    {
      heading: "Add structure only when you need it",
      body: [
        "Planning features are switched on per project in Settings > Projects > your project > Features. A project that doesn't use them never sees them. Turning one off hides it but deletes nothing.",
      ],
      items: [
        {
          name: "Cycles",
          href: "/docs/core/functional/cycles",
          meta: "When you plan in fixed periods",
          body: "Time-boxed sprints whose status follows their dates, with a burndown and a one-step transfer of unfinished work.",
        },
        {
          name: "Intake",
          href: "/docs/core/functional/intake",
          meta: "When requests pile up in chat",
          body: "A review queue for requests from outside the team. Nothing reaches the board until someone accepts it.",
        },
        {
          name: "Pages",
          href: "/docs/core/functional/pages",
          meta: "On by default",
          body: "Specs and notes next to the tasks, edited together live, with version history and private drafts.",
        },
        {
          name: "Estimates, modules and time tracking",
          href: "/docs/core/functional/project-features-and-column-groups",
          meta: "When you need to size or group work",
          body: "Points or time estimates, larger pieces of work that span cycles, and time logged against tasks.",
        },
      ],
    },
  ],
  faq: [
    {
      question: "How many projects should a small team have?",
      answer:
        "As few as you can. One per stream of work is a good rule. If two projects always move together, merge them and tell the work apart with labels.",
    },
    {
      question: "Do we need sprints?",
      answer:
        "Not unless you already plan in fixed periods. Many small teams do well with a board and due dates. Turn on cycles when you want to commit to a set of work for a week or two.",
    },
    {
      question: "Can people outside the team see the work?",
      answer:
        "Yes, in two ways. Invite them as Viewers, who can follow along and submit intake requests. Or publish a project as a public board that anyone with the link can open, choosing whether visitors can vote, comment or send requests.",
    },
    {
      question: "Is Margaya free for a small team?",
      answer:
        "Yes. Margaya is open source, and you can run it on your own server free under the GNU AGPL-3.0, with every feature. If you want to use it without the AGPL's conditions, for example to keep your changes private, a commercial licence is available; COMMERCIAL.md in the GitHub repository explains it.",
    },
  ],
  next: [
    {
      label: "Save and share views",
      href: "/docs/core/functional/views",
      description:
        "Save the filters and layouts you check every day, and share them.",
    },
    {
      label: "Keyboard shortcuts",
      href: "/docs/core/functional/keyboard-shortcuts",
      description:
        "Every shortcut, from Ctrl K to the single-key task pickers.",
    },
    {
      label: "Plan work in cycles",
      href: "/docs/core/functional/cycles",
      description: "Set up sprints with automatic status and carry-over.",
    },
  ],
  updatedOn: "2026-11-03",
};
