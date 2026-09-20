import { getModifierKeyText } from "@/hooks/use-keyboard-shortcuts";

export const shortcuts = {
  project: {
    prefix: "p",
    create: "c",
    list: "l",
  },
  workspace: {
    prefix: "w",
    switch: "s",
    create: "c",
  },
  notification: {
    prefix: "n",
    open: "o",
    inbox: "i",
  },
  // Toggles the shell's context panel (pinned on desktop, a drawer below).
  sidebar: {
    prefix: getModifierKeyText(),
    toggle: "b",
  },
  // Opens the command bar; `>` `#` `@` `/` narrow it (command-palette/
  // palette-query.ts).
  palette: {
    prefix: getModifierKeyText(),
    open: "k",
  },
  search: {
    prefix: "/",
  },
  task: {
    prefix: "t",
    create: "c",
  },
  view: {
    prefix: "v",
    board: "b",
    calendar: "c",
    gantt: "g",
    list: "l",
    backlog: "k",
    spreadsheet: "s",
  },
  // Workspace pages, from anywhere: "g h" Home, "g a" All tasks, "g y" Your
  // work, "g s" Stickies.
  workspaceGo: {
    prefix: "g",
    home: "h",
    allTasks: "a",
    myWork: "y",
    stickies: "s",
  },
  // Project sections; each section's second key lives in its registration.
  section: {
    prefix: "g",
  },
  // The board and list: `c` focuses the capture bar. The list's triage keys
  // are single keys that no prefix above uses; priority is `!` (Shift 1)
  // because `p` is the project prefix.
  capture: {
    open: "c",
  },
  triage: {
    next: "j",
    previous: "k",
    select: "x",
    status: "s",
    priority: "!",
    assignee: "a",
  },
  // The open task (sheet or page): single keys open its pickers. The
  // chords take Ctrl/⌘ (`modifier` below); Ctrl+Shift+C would open the
  // browser's dev tools, hence `.` and Shift `,`.
  taskDetails: {
    status: "s",
    priority: "p",
    assignee: "a",
    labels: "l",
    dueDate: "d",
    assignSelf: "i",
    modifier: getModifierKeyText(),
    copyKey: ".",
    copyLink: ",",
    copyBranch: "G",
    delete: "Backspace",
  },
  help: {
    key: "?",
  },
} as const;
