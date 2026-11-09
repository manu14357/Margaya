/**
 * Screenshots for the task and project-setup docs (apps/docs/core/functional).
 *
 * LOCAL DEVELOPMENT ONLY. Besides the Studio North seed, these screens need a
 * restricted project, a published board, task templates, a repeating task, a
 * task with description history, custom fields and logged time. ensureTasksDemo()
 * creates them through the public API the first time and reuses them afterwards.
 * Custom fields, dated tasks and time live on the Hiring project, which no
 * other section's shots open; its calendar and analytics shots are here too.
 * The press user keeps a running timer there, restarted on each run.
 */

process.env.PRESS_API_URL ??= "http://127.0.0.1:1337";
process.env.PRESS_CLIENT_URL ??= "http://localhost:5173";
const { DEMO_USERS, DEMO_WORKSPACE, signIn } = await import(
  "../../press/seed-demo.mjs"
);

/**
 * Tasks: [title, status, priority, assignee, label?, start?, due?]. Start and
 * due are day offsets from today. Only unassigned tasks and Sofia's get dates,
 * so Your work, Home and Priya's profile look as in the other shots; the dated
 * ones fill the Hiring calendar and the custom field chart.
 */
const HIRING = {
  name: "Hiring",
  slug: "HIR",
  icon: "Users",
  members: [
    ["priya", "admin"],
    ["sofia", "member"],
    ["jonas", "viewer"],
  ],
  tasks: [
    [
      "Schedule final interviews for the senior designer",
      "in-progress",
      "high",
      "priya",
    ],
    [
      "Draft the offer letter for the frontend lead",
      "to-do",
      "medium",
      "press",
    ],
    ["Refresh the careers page listings", "to-do", "low", "sofia", null, 3, 9],
    ["Send take-home review notes to candidates", "done", "medium", "priya"],
    [
      "Phone screen for the junior support engineer",
      "to-do",
      "medium",
      null,
      null,
      1,
      2,
    ],
    ["Post the QA internship on job boards", "done", "low", null, null, -9, -7],
    [
      "Reference checks for the backend engineer",
      "in-progress",
      "high",
      null,
      null,
      0,
      2,
    ],
    [
      "Take-home exercise for the frontend engineer",
      "to-do",
      "medium",
      null,
      null,
      4,
      6,
    ],
    [
      "Portfolio review for the product designer",
      "in-progress",
      "medium",
      null,
      null,
      -1,
      4,
    ],
    [
      "Panel interview for the engineering lead",
      "to-do",
      "high",
      null,
      null,
      7,
      8,
    ],
  ],
};

const ROADMAP = {
  name: "Public roadmap",
  slug: "RMP",
  icon: "Target",
  tasks: [
    [
      "Dark mode for the client portal",
      "in-progress",
      "high",
      "sofia",
      "Design",
    ],
    [
      "Faster search across projects",
      "in-progress",
      "medium",
      "jonas",
      "Backend",
    ],
    ["Export reports as CSV", "to-do", "medium", "theo", "Backend"],
    ["Shared project templates", "to-do", "low", "priya", "Frontend"],
    [
      "Calendar sync with Google and Outlook",
      "in-review",
      "high",
      "jonas",
      "Frontend",
    ],
    ["Two-factor sign-in", "done", "urgent", "theo", "Backend"],
  ],
  comment: [
    "Dark mode for the client portal",
    "priya",
    "Thanks for all the votes on this one. A first version ships with the next portal release.",
  ],
};

const TEMPLATES = [
  {
    name: "Bug report",
    titlePattern: "Bug: {title}",
    description: [
      "## Steps to reproduce",
      "",
      "1. ",
      "",
      "## Expected",
      "",
      "## Actual",
    ].join("\n"),
    priority: "high",
    labels: ["Bug", "Backend"],
    subtasks: [
      "Reproduce on staging",
      "Write a failing test",
      "Fix and add a release note",
    ],
  },
  {
    name: "New endpoint",
    titlePattern: "Endpoint: {title}",
    description:
      "Describe the request, the response and who may call it. Link the design doc.",
    priority: "medium",
    labels: ["Backend", "Docs"],
    subtasks: [
      "Write the OpenAPI schema",
      "Add integration tests",
      "Document it",
    ],
  },
];

const CUSTOM_FIELDS = [
  {
    name: "Seniority",
    type: "dropdown",
    options: ["Junior", "Mid-level", "Senior", "Lead"],
  },
  { name: "Interview rounds", type: "number" },
  { name: "Target start", type: "date" },
  { name: "Referral", type: "boolean", defaultValue: "false" },
];
const FIELD_VALUES = [
  [
    "Schedule final interviews for the senior designer",
    { Seniority: "Senior", "Interview rounds": "3" },
  ],
  [
    "Draft the offer letter for the frontend lead",
    { Seniority: "Lead", "Interview rounds": "4" },
  ],
  [
    "Send take-home review notes to candidates",
    { Seniority: "Mid-level", "Interview rounds": "2" },
  ],
  [
    "Phone screen for the junior support engineer",
    { Seniority: "Junior", "Interview rounds": "1" },
  ],
  [
    "Post the QA internship on job boards",
    { Seniority: "Junior", "Interview rounds": "1" },
  ],
  [
    "Reference checks for the backend engineer",
    { Seniority: "Mid-level", "Interview rounds": "3" },
  ],
  [
    "Take-home exercise for the frontend engineer",
    { Seniority: "Mid-level", "Interview rounds": "3" },
  ],
  [
    "Portfolio review for the product designer",
    { Seniority: "Senior", "Interview rounds": "2" },
  ],
  [
    "Panel interview for the engineering lead",
    { Seniority: "Lead", "Interview rounds": "4" },
  ],
];
const FIELD_VIEW = "By seniority";

const TIMED_TASK = "Draft the offer letter for the frontend lead";
/**
 * Hours ago it started, minutes it took, and its note. The second note is long
 * on purpose: the popover cuts it short and keeps the edit and delete buttons
 * in view.
 */
const TIME_ENTRIES = [
  [50, 90, "First pass at the offer"],
  [
    26,
    45,
    "Checked the salary band against the latest market survey and the two offers we made this spring",
  ],
];

const REPEATING_TITLE = "Weekly dependency updates";
const HISTORY_TITLE = "Write the API versioning policy";
// Alternating authors, so each edit is its own version.
const HISTORY_VERSIONS = [
  ["press", "Decide how we version the public API.\n\n- Version in the URL"],
  [
    "priya",
    "Decide how we version the public API before v2 ships.\n\n- Version in the URL (`/v2/...`)\n- Support each version for 12 months",
  ],
  [
    "press",
    "Agree how we version the public API before v2 ships.\n\n## Proposal\n\n- Version in the URL (`/v2/...`)\n- Support each version for 12 months after its successor ships\n- Announce deprecations in the changelog and by email",
  ],
];

function day(offset, hour = 12) {
  const date = new Date();
  date.setUTCHours(hour, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offset);
  return date;
}

async function listTasks(session, projectId) {
  const board = await session.get(`/task/tasks/${projectId}`, {
    limit: 100,
    page: 1,
  });
  return [
    ...board.data.columns.flatMap((c) => c.tasks),
    ...board.data.plannedTasks,
    ...board.data.archivedTasks,
  ];
}

async function ensureTasksDemo() {
  const s = {};
  for (const key of ["press", "priya", "jonas", "theo", "sofia"]) {
    s[key] = await signIn(DEMO_USERS[key]);
  }
  const press = s.press;
  const workspace = (await press.get("/auth/organization/list")).find(
    (w) => w.name === DEMO_WORKSPACE.name,
  );
  if (!workspace) throw new Error("Run scripts/press/seed-demo.mjs first");
  const workspaceId = workspace.id;
  for (const session of Object.values(s)) {
    await session.call("POST", "/auth/organization/set-active", {
      organizationId: workspaceId,
    });
  }
  const projects = await press.get("/project", {
    workspaceId,
    includeArchived: "true",
  });
  const labels = await press.get(`/label/workspace/${workspaceId}`);
  const labelId = (name) =>
    labels.find((l) => l.taskId === null && l.name === name)?.id;
  const bySlug = (slug) =>
    projects.find((p) => p.slug.toLowerCase() === slug.toLowerCase());

  const ensureProject = async (spec, extra = {}) => {
    let project = bySlug(spec.slug);
    if (!project) {
      project = await press.call("POST", "/project", {
        name: spec.name,
        workspaceId,
        icon: spec.icon,
        slug: spec.slug,
        ...extra,
      });
    }
    const existing = await listTasks(press, project.id);
    const tasks = {};
    for (const [
      title,
      status,
      priority,
      who,
      label,
      start,
      due,
    ] of spec.tasks) {
      const dates =
        due === undefined
          ? {}
          : {
              startDate: day(start, 9).toISOString(),
              dueDate: day(due, 17).toISOString(),
            };
      let task = existing.find((t) => t.title === title);
      if (!task) {
        task = await press.call("POST", `/task/${project.id}`, {
          title,
          description: "",
          priority,
          status,
          assigneeIds: who ? [s[who].id] : [],
          ...dates,
        });
      } else if (dates.dueDate && !task.dueDate) {
        // Seeded before these tasks had dates.
        await press.call("PUT", `/task/dates/${task.id}`, dates);
      }
      if (label && !(task.labels ?? []).some((l) => l.name === label)) {
        await press.call("PUT", `/label/${labelId(label)}/task`, {
          taskId: task.id,
        });
      }
      tasks[title] = { id: task.id, number: task.number };
    }
    return { id: project.id, slug: project.slug, tasks };
  };

  // A restricted project with members in three project roles.
  const hiring = await ensureProject(HIRING, { visibility: "restricted" });
  const access = await press.get(`/project/${hiring.id}/access`);
  if (access.visibility !== "restricted") {
    await press.call("PUT", `/project/${hiring.id}/access/visibility`, {
      visibility: "restricted",
    });
  }
  for (const [who, role] of HIRING.members) {
    if (access.members.some((m) => m.userId === s[who].id)) continue;
    await press.call("POST", `/project/${hiring.id}/access/members`, {
      userId: s[who].id,
      role,
    });
  }

  // Custom fields, their values, and a view that groups by one of them.
  await press.call("PATCH", `/project/${hiring.id}/features`, {
    viewsEnabled: true,
  });
  const fields = await press.get(`/custom-field/project/${hiring.id}`);
  const fieldIds = {};
  for (const field of CUSTOM_FIELDS) {
    const found =
      fields.find((f) => f.name === field.name) ??
      (await press.call("POST", "/custom-field", {
        projectId: hiring.id,
        required: false,
        ...field,
      }));
    fieldIds[field.name] = found.id;
  }
  for (const [title, values] of FIELD_VALUES) {
    for (const [name, value] of Object.entries(values)) {
      await press.call("PUT", "/custom-field/value", {
        taskId: hiring.tasks[title].id,
        fieldId: fieldIds[name],
        value,
      });
    }
  }
  const hiringViews = await press.get("/view", {
    workspaceId,
    projectId: hiring.id,
  });
  const fieldView =
    (Array.isArray(hiringViews)
      ? hiringViews
      : (hiringViews?.views ?? [])
    ).find((v) => v.name === FIELD_VIEW) ??
    (await press.call("POST", "/view", {
      workspaceId,
      projectId: hiring.id,
      access: "workspace",
      name: FIELD_VIEW,
      display: {
        layout: "list",
        groupBy: `customField:${fieldIds.Seniority}`,
      },
    }));

  // Time on one task, all logged by the press user so their inbox stays as
  // seeded, and a timer that has been running for 25 minutes.
  const timedTaskId = hiring.tasks[TIMED_TASK].id;
  const logged = await press.get(`/time-entry/task/${timedTaskId}`);
  for (const [hoursAgo, minutes, description] of TIME_ENTRIES) {
    if (logged.some((entry) => entry.description === description)) continue;
    const start = Date.now() - hoursAgo * 60 * 60 * 1000;
    await press.call("POST", "/time-entry", {
      taskId: timedTaskId,
      startTime: new Date(start).toISOString(),
      endTime: new Date(start + minutes * 60 * 1000).toISOString(),
      description,
    });
  }
  const { entry: running } = await press.get("/time-entry/running", {
    workspaceId,
  });
  if (running) await press.call("DELETE", `/time-entry/${running.id}`);
  await press.call("POST", "/time-entry", {
    taskId: timedTaskId,
    startTime: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
  });

  // A published roadmap with comments, reactions and votes on.
  const roadmap = await ensureProject(ROADMAP);
  let publication = await press.get(`/publication/project/${roadmap.id}`);
  if (!publication.published) {
    publication = await press.call(
      "POST",
      `/publication/project/${roadmap.id}/publish`,
      {
        layouts: ["board", "list"],
        defaultLayout: "board",
        commentsEnabled: true,
        reactionsEnabled: true,
        votesEnabled: true,
      },
    );
  }
  const [commentTask, commentBy, commentText] = ROADMAP.comment;
  const commentTaskId = roadmap.tasks[commentTask].id;
  const listed = await press.get(`/comment/${commentTaskId}`);
  const comments = Array.isArray(listed) ? listed : (listed?.comments ?? []);
  let comment = comments.find((c) =>
    String(c.content ?? "").includes(commentText.slice(0, 30)),
  );
  comment ??= await s[commentBy].call("POST", `/comment/${commentTaskId}`, {
    content: commentText,
  });
  if (comment.visibility !== "public") {
    // Only the author may make their own comment public.
    await s[commentBy].call(
      "PATCH",
      `/publication/comment/${comment.id}/visibility`,
      { visibility: "public" },
    );
  }

  // Templates, a repeating task and description history on Platform API.
  const api = bySlug("API");
  const templates = await press.get(`/task-template/project/${api.id}`);
  const templateList = Array.isArray(templates)
    ? templates
    : (templates?.templates ?? []);
  for (const t of TEMPLATES) {
    if (templateList.some((x) => x.name === t.name)) continue;
    await press.call("POST", "/task-template", {
      projectId: api.id,
      name: t.name,
      titlePattern: t.titlePattern,
      description: t.description,
      priority: t.priority,
      labelIds: t.labels.map(labelId).filter(Boolean),
      subtasks: t.subtasks,
    });
  }

  const apiTasks = await listTasks(press, api.id);
  let repeating = apiTasks.find((t) => t.title === REPEATING_TITLE);
  if (!repeating) {
    // Next Monday, so the weekly rule reads naturally.
    const offset = (8 - day(0).getUTCDay()) % 7 || 7;
    repeating = await press.call("POST", `/task/${api.id}`, {
      title: REPEATING_TITLE,
      description:
        "Review the open dependency update pull requests, merge the safe ones and note anything that needs a migration.",
      priority: "medium",
      status: "to-do",
      assigneeIds: [s.jonas.id],
      dueDate: day(offset, 17).toISOString(),
    });
  }
  const recurrence = await press.request(
    "GET",
    `/task-recurrence/${repeating.id}`,
  );
  if (!recurrence.ok || !recurrence.data?.recurrence) {
    await press.call("PUT", `/task-recurrence/${repeating.id}`, {
      frequency: "weekly",
      weekdays: [1],
      trigger: "completion",
    });
  }

  let history = apiTasks.find((t) => t.title === HISTORY_TITLE);
  history ??= await press.call("POST", `/task/${api.id}`, {
    title: HISTORY_TITLE,
    description: "",
    priority: "medium",
    status: "in-progress",
    assigneeIds: [s.priya.id],
  });
  const versions = await press.get(`/task/${history.id}/description-versions`);
  const versionList = Array.isArray(versions)
    ? versions
    : (versions?.versions ?? []);
  if (versionList.length < HISTORY_VERSIONS.length) {
    for (const [who, description] of HISTORY_VERSIONS) {
      await s[who].call("PUT", `/task/description/${history.id}`, {
        description,
      });
    }
  }

  return {
    workspaceId,
    hiring: { ...hiring, viewId: fieldView.id, timedTaskId },
    roadmap: { ...roadmap, path: publication.path },
    api: {
      id: api.id,
      repeatingId: repeating.id,
      historyId: history.id,
    },
  };
}

export const demo = await ensureTasksDemo();

const ws = (seed) => `/dashboard/workspace/${seed.workspace.id}`;
const board = (seed, projectId, query = "") =>
  `${ws(seed)}/project/${projectId}/board${query}`;
const settings = (projectId, page) =>
  `/dashboard/settings/projects/${projectId}/${page}`;
const webId = (seed) => seed.projects.web.id;
const pricing = (seed) => `?taskId=${seed.projects.web.tasks.pricing.id}`;

/** A settings section, found by its heading, with some page around it. */
const section = (title, pad = 16) => ({
  selector: `xpath=//h2[normalize-space()="${title}"]/ancestor::section[1]`,
  pad,
});
// Settings content is 720px wide, centred in the 1440px viewport.
const SETTINGS_COLUMN = { x: 500, width: 752 };
const TALL = { width: 1440, height: 1800 };
const VERY_TALL = { width: 1440, height: 2600 };
const dialog = (text, pad = 0) => ({
  selector: `[role=dialog]:has-text("${text}")`,
  pad,
});

/**
 * Crops a shot to what prepare opened plus the control that opened it. The
 * runner reads `shot.clip` after prepare, so prepare can set it.
 */
async function clipAround(shot, locators, pad = 12) {
  const boxes = [];
  for (const locator of locators) {
    const box = await locator.first().boundingBox();
    if (box) boxes.push(box);
  }
  const left = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad);
  const top = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad);
  const right = Math.max(...boxes.map((b) => b.x + b.width)) + pad;
  const bottom = Math.max(...boxes.map((b) => b.y + b.height)) + pad;
  shot.clip = {
    x: Math.floor(left),
    y: Math.floor(top),
    width: Math.ceil(right - Math.floor(left)),
    height: Math.ceil(bottom - Math.floor(top)),
  };
}

const boardFilter = {
  name: "tasks/board-filter",
  url: (seed) => board(seed, webId(seed)),
  ready: "Annual billing toggle",
  prepare: async (page) => {
    const button = page
      .getByRole("button", { name: "Filter", exact: true })
      .first();
    await button.click();
    await page.getByText("Filter by", { exact: true }).waitFor();
    await clipAround(boardFilter, [button, page.getByRole("menu")], 12);
  },
};

const timePopover = {
  name: "tasks/time-tracking-popover",
  url: (seed) =>
    board(seed, demo.hiring.id, `?taskId=${demo.hiring.timedTaskId}`),
  ready: TIMED_TASK,
  prepare: async (page) => {
    const trigger = page.getByRole("button", { name: "Timer running" });
    await trigger.first().click();
    await page.getByRole("list", { name: "Time entries" }).waitFor();
    // As wide as the popover: the trigger's row reaches past it, over the panel.
    const popup = await page.locator("[data-slot=popover-popup]").boundingBox();
    const button = await trigger.first().boundingBox();
    timePopover.clip = {
      x: Math.floor(popup.x) - 2,
      y: Math.floor(popup.y) - 2,
      width: Math.ceil(popup.width) + 4,
      height: Math.ceil(button.y + button.height - popup.y) + 4,
    };
  },
};

/** Hiring's calendar showing each task's Seniority, chosen in the toolbar. */
const fieldCalendar = {
  name: "tasks/custom-field-calendar",
  url: (seed) => `${ws(seed)}/project/${demo.hiring.id}/calendar`,
  ready: "Show weekends",
  viewport: { width: 1440, height: 760 },
  // The corner the runner parks the pointer in is a day cell, and hovering one
  // shows its add button.
  keepPointer: true,
  prepare: async (page) => {
    // The choice is kept in this browser context only.
    await page.getByRole("combobox", { name: "Field shown on tasks" }).click();
    await page.getByRole("option", { name: "Seniority", exact: true }).click();
    await page.getByTestId("calendar-field-value").first().waitFor();
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.mouse.move(1300, 68);
    // Ends with the last week that has a task; week rows carry an inline grid.
    const bottom = await page
      .locator("[data-task-status]")
      .evaluateAll((bars) =>
        Math.max(
          ...bars.map((bar) => {
            let week = bar;
            while (week && !week.style?.gridTemplateRows) {
              week = week.parentElement;
            }
            return (week ?? bar).getBoundingClientRect().bottom;
          }),
        ),
      );
    fieldCalendar.clip = {
      x: 312,
      y: 0,
      width: 1128,
      height: Math.min(760, Math.ceil(bottom)),
    };
  },
};

/** Hiring's open and completed tasks per Seniority option, in Analytics. */
const fieldChart = {
  name: "analytics/custom-field-chart",
  url: (seed) => `${ws(seed)}/project/${demo.hiring.id}/analytics`,
  ready: "Custom chart",
  viewport: { width: 1440, height: 1800 },
  prepare: async (page) => {
    const card = page.locator(fieldChart.clip.selector);
    await card.scrollIntoViewIfNeeded();
    await card.getByRole("combobox", { name: "X-axis" }).click();
    await page.getByRole("option", { name: "Seniority", exact: true }).click();
    await card.getByRole("combobox", { name: "Segment" }).click();
    await page.getByRole("option", { name: "Group", exact: true }).click();
    await card.getByText("Mid-level").first().waitFor();
    await card.scrollIntoViewIfNeeded();
  },
  clip: {
    selector:
      'xpath=//h2[normalize-space()="Custom chart"]/ancestor::*[@data-slot="card"][1]',
    pad: 0,
  },
};

/** Selects two cards on the Website relaunch board. */
async function selectTwoCards(page) {
  for (const title of ["Newsletter sign-up flow", "Annual billing toggle"]) {
    await page
      .getByText(title, { exact: true })
      .first()
      .click({ modifiers: ["ControlOrMeta"] });
  }
  await page.getByRole("toolbar").getByText("2 selected").waitFor();
}

const columnGroupPicker = {
  name: "tasks/column-group-picker",
  url: (seed) => settings(webId(seed), "workflow"),
  ready: "Sort by group",
  viewport: TALL,
  prepare: async (page) => {
    const columns = page.locator(section("Columns").selector);
    await columns.getByRole("combobox").first().click();
    await page.getByRole("option", { name: /Cancelled/ }).waitFor();
    await clipAround(
      columnGroupPicker,
      [columns, page.getByRole("listbox")],
      16,
    );
  },
  keepPointer: true,
};

const repeatEditor = {
  name: "tasks/repeat-editor",
  url: (seed) => board(seed, demo.api.id, `?taskId=${demo.api.repeatingId}`),
  ready: "Every week on Mon",
  prepare: async (page) => {
    const trigger = page.getByRole("button", { name: /Every week on Mon/ });
    await trigger.first().click();
    await page.getByText("Repeat this task").waitFor();
    await clipAround(
      repeatEditor,
      [trigger, page.locator("[data-slot=popover-popup]")],
      2,
    );
  },
};

const publishMenu = {
  name: "tasks/publish-menu",
  url: (seed) => board(seed, demo.api.id),
  ready: "Rate limiting per API key",
  prepare: async (page) => {
    const row = page
      .locator("li")
      .filter({
        has: page.getByRole("button", { name: "Public roadmap", exact: true }),
      })
      .first();
    await row.hover();
    await row.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Publish…" }).waitFor();
    await clipAround(
      publishMenu,
      [row.locator("xpath=ancestor::ul[1]"), page.locator("[role=menu]")],
      4,
    );
  },
  keepPointer: true,
};

export default [
  // plan-and-execute-tasks
  {
    name: "tasks/board-view",
    url: (seed) => board(seed, webId(seed)),
    ready: "Annual billing toggle",
    clip: { selector: "main", pad: 0 },
  },
  {
    name: "tasks/create-task-dialog",
    url: (seed) => board(seed, webId(seed)),
    ready: "Annual billing toggle",
    prepare: async (page) => {
      await page.getByRole("button", { name: "Add task" }).nth(1).click();
      await page.getByText("New task").first().waitFor();
      await page.keyboard.type("Redesign pricing page header");
      await page.getByText("Similar open tasks").waitFor();
    },
    clip: dialog("Similar open tasks"),
  },
  boardFilter,
  {
    name: "tasks/list-view",
    url: (seed) => board(seed, webId(seed)),
    ready: "Annual billing toggle",
    prepare: async (page) => {
      // The layout is a synced preference; keep the switch out of the
      // account so other shots still open on the board.
      await page.route("**/api/user/preferences", (route) =>
        route.request().method() === "GET"
          ? route.continue()
          : route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({
                preferences: { theme: "light", viewMode: "list" },
              }),
            }),
      );
      await page
        .getByRole("main")
        .getByRole("tab", { name: "List", exact: true })
        .click();
      await page.waitForTimeout(800);
    },
    clip: { selector: "main", pad: 0 },
  },
  {
    name: "tasks/task-sheet",
    url: (seed) => board(seed, webId(seed), pricing(seed)),
    ready: "Plan comparison table with the enterprise column",
    clip: { selector: "[role=dialog]", pad: 0 },
  },

  // bulk-edit-tasks
  {
    name: "tasks/bulk-toolbar",
    url: (seed) => board(seed, webId(seed)),
    ready: "Annual billing toggle",
    prepare: selectTwoCards,
    clip: { selector: "main", pad: 0 },
  },
  {
    name: "tasks/bulk-move-dialog",
    url: (seed) => board(seed, webId(seed)),
    ready: "Annual billing toggle",
    prepare: async (page) => {
      await selectTwoCards(page);
      await page
        .getByRole("toolbar")
        .getByRole("button", { name: "Actions" })
        .click();
      await page
        .getByRole("group", { name: "Move to project" })
        .getByRole("option", { name: "Mobile app" })
        .click();
      // Stops at the confirmation: nothing moves.
      await page.getByRole("alertdialog").waitFor();
    },
    clip: { selector: "[role=alertdialog]", pad: 0 },
  },

  // custom-fields
  {
    name: "tasks/custom-fields",
    url: () => settings(demo.hiring.id, "workflow"),
    ready: "Interview rounds",
    viewport: TALL,
    clip: section("Custom fields"),
  },
  {
    name: "tasks/custom-field-edit",
    url: () => settings(demo.hiring.id, "workflow"),
    ready: "Interview rounds",
    viewport: TALL,
    prepare: async (page) => {
      await page
        .getByRole("listitem")
        .filter({ hasText: "Seniority" })
        .getByRole("button", { name: /^Edit/ })
        .click();
      await page.getByRole("button", { name: "Add option" }).waitFor();
    },
    clip: dialog("Edit custom field"),
  },
  {
    name: "tasks/custom-field-group",
    url: (seed) =>
      `${ws(seed)}/project/${demo.hiring.id}/views/${demo.hiring.viewId}`,
    ready: "No value",
    // Tall enough for every group, down to No value.
    viewport: { width: 1440, height: 680 },
    clip: { selector: "main", pad: 0 },
  },
  fieldCalendar,
  fieldChart,

  // time-tracking
  timePopover,

  // multiple-assignees
  {
    name: "tasks/assignee-picker",
    url: (seed) => board(seed, webId(seed), pricing(seed)),
    ready: "Plan comparison table with the enterprise column",
    prepare: async (page) => {
      await page.getByText("Priya Raman +1").click();
      await page.getByText("Clear assignees").waitFor();
    },
    clip: { x: 896, y: 410, width: 536, height: 372 },
  },

  // description-history
  {
    name: "tasks/description-history",
    url: (seed) => board(seed, demo.api.id, `?taskId=${demo.api.historyId}`),
    ready: HISTORY_TITLE,
    prepare: async (page) => {
      await page.getByRole("button", { name: "History" }).click();
      const history = page.locator(dialog("Description history").selector);
      await history.getByText("Priya Raman").click();
      await history.getByRole("button", { name: "Restore" }).waitFor();
    },
    clip: dialog("Description history"),
  },

  // collaborate-with-team
  {
    name: "tasks/invite-member",
    url: (seed) => `${ws(seed)}/members`,
    ready: "Priya Raman",
    prepare: async (page) => {
      await page.getByRole("button", { name: "Invite member" }).first().click();
      await page
        .getByRole("textbox")
        .first()
        .fill("maya.lind@margaya.test, omar.haddad@margaya.test");
    },
    clip: dialog("Invite team member"),
  },

  // guest-access
  {
    name: "tasks/invite-guest",
    url: (seed) => `${ws(seed)}/members`,
    ready: "Priya Raman",
    prepare: async (page) => {
      await page.getByRole("button", { name: "Invite member" }).first().click();
      const invite = page.locator(
        '[role=dialog]:has-text("Invite team member")',
      );
      await invite.getByRole("textbox").first().fill("maya.lind@margaya.test");
      await invite.getByRole("combobox").click();
      await page.getByRole("option", { name: "Guest", exact: true }).click();
      // One project at the default Viewer role and one raised to Member.
      // Nothing is sent.
      await invite.getByRole("checkbox", { name: "Website relaunch" }).click();
      await invite.getByRole("checkbox", { name: "Mobile app" }).click();
      await invite
        .getByRole("combobox", { name: "Project role in Mobile app" })
        .click();
      await page.getByRole("option", { name: "Member", exact: true }).click();
      await invite
        .getByRole("combobox", { name: "Project role in Mobile app" })
        .getByText("Member")
        .waitFor();
    },
    clip: dialog("Invite team member"),
  },
  {
    name: "tasks/guest-access",
    url: (seed) => settings(webId(seed), "general"),
    ready: "Add member",
    viewport: TALL,
    // Answered in the browser: a real guest in the demo workspace would show up
    // in the member lists of other shots.
    before: (page, seed) =>
      page.route(
        (url) => url.pathname === `/api/project/${webId(seed)}/access`,
        (route) =>
          route.request().method() === "GET"
            ? route.fulfill({
                status: 200,
                json: {
                  visibility: "open",
                  leadUserId: null,
                  canManage: true,
                  members: [
                    {
                      userId: "docs-shot-guest",
                      role: "viewer",
                      addedAt: "2026-01-15T09:00:00.000Z",
                      name: "Maya Lind",
                      email: "maya.lind@margaya.test",
                      image: null,
                    },
                  ],
                },
              })
            : route.fallback(),
      ),
    clip: section("Access"),
  },

  // configure-workflows and project-features-and-column-groups
  {
    name: "tasks/workflow-columns",
    url: (seed) => settings(webId(seed), "workflow"),
    ready: "Sort by group",
    viewport: TALL,
    clip: section("Columns"),
  },
  {
    name: "tasks/workflow-integration-rules",
    url: (seed) => settings(webId(seed), "workflow"),
    ready: "Sort by group",
    viewport: TALL,
    clip: section("Integration rules"),
  },
  columnGroupPicker,
  {
    name: "tasks/project-features",
    url: (seed) => settings(webId(seed), "features"),
    ready: "Time tracking",
    clip: section("Planning features"),
  },

  // restricted-projects
  {
    name: "tasks/restricted-access",
    url: () => settings(demo.hiring.id, "general"),
    ready: "Add member",
    viewport: TALL,
    clip: section("Access"),
  },

  // manage-workspace-labels
  {
    name: "tasks/workspace-labels",
    url: "/dashboard/settings/workspace/labels",
    ready: "Research",
    clip: { ...SETTINGS_COLUMN, y: 64, height: 416 },
  },
  {
    name: "tasks/create-label",
    url: "/dashboard/settings/workspace/labels",
    ready: "Research",
    prepare: async (page) => {
      await page.getByRole("button", { name: "Create label" }).click();
      await page.locator("[role=dialog] input").first().fill("Infra");
    },
    clip: { selector: "[role=dialog]", pad: 0 },
  },

  // automations
  {
    name: "tasks/scheduled-automations",
    url: (seed) => settings(webId(seed), "workflow"),
    ready: "Roll over unfinished cycle work",
    viewport: VERY_TALL,
    clip: section("Scheduled automations"),
  },

  // task-templates
  {
    name: "tasks/task-templates",
    url: () => settings(demo.api.id, "workflow"),
    ready: "New endpoint",
    viewport: VERY_TALL,
    clip: section("Task templates"),
  },
  {
    name: "tasks/edit-template",
    url: () => settings(demo.api.id, "workflow"),
    ready: "New endpoint",
    viewport: VERY_TALL,
    prepare: async (page) => {
      await page
        .getByRole("button", { name: "Edit template Bug report" })
        .click();
      await page.locator("[role=dialog]").waitFor();
    },
    clip: { selector: "[role=dialog]", pad: 0 },
  },
  {
    name: "tasks/use-template",
    url: (seed) => board(seed, demo.api.id),
    ready: "Rate limiting per API key",
    prepare: async (page) => {
      await page.getByRole("button", { name: "Add task" }).first().click();
      await page.getByText("New task").first().waitFor();
      await page.keyboard.type("Webhook signature mismatch");
      await page.getByRole("button", { name: "Template" }).click();
      await page.getByText("Use a template").waitFor();
    },
    clip: { selector: "[role=dialog]", pad: 0 },
  },

  // repeating-tasks
  repeatEditor,

  // publish-a-project-board
  publishMenu,
  {
    name: "tasks/publish-status",
    url: () => settings(demo.roadmap.id, "visibility"),
    ready: "Anyone with the link can view this board.",
    viewport: TALL,
    clip: { ...SETTINGS_COLUMN, y: 64, height: 270 },
  },
  {
    name: "tasks/publish-participation",
    url: () => settings(demo.roadmap.id, "visibility"),
    ready: "Anyone with the link can view this board.",
    viewport: TALL,
    clip: section("Participation"),
  },
  {
    name: "tasks/publish-moderation",
    url: () => settings(demo.roadmap.id, "visibility"),
    ready: "Recent public comments",
    viewport: TALL,
    clip: section("Moderation"),
  },
  {
    name: "tasks/public-board",
    url: () => demo.roadmap.path,
    ready: "Dark mode for the client portal",
    viewport: { width: 1280, height: 520 },
  },
];
