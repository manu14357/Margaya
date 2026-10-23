/**
 * Screenshots for the task and project-setup docs (apps/docs/core/functional).
 *
 * LOCAL DEVELOPMENT ONLY. Besides the Studio North seed, these screens need a
 * restricted project, a published board, task templates, a repeating task and
 * a task with description history. ensureTasksDemo() creates them through the
 * public API the first time and reuses them afterwards.
 */

process.env.PRESS_API_URL ??= "http://127.0.0.1:1337";
process.env.PRESS_CLIENT_URL ??= "http://localhost:5173";
const { DEMO_USERS, DEMO_WORKSPACE, signIn } = await import(
  "../../press/seed-demo.mjs"
);

/** Tasks: [title, status, priority, assignee, label?]. */
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
    ["Refresh the careers page listings", "to-do", "low", "sofia"],
    ["Send take-home review notes to candidates", "done", "medium", "priya"],
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
    for (const [title, status, priority, who, label] of spec.tasks) {
      const task =
        existing.find((t) => t.title === title) ??
        (await press.call("POST", `/task/${project.id}`, {
          title,
          description: "",
          priority,
          status,
          assigneeIds: [s[who].id],
        }));
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
  if (!recurrence.ok || !recurrence.data?.frequency) {
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
    hiring,
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
  {
    name: "tasks/board-filter",
    url: (seed) => board(seed, webId(seed)),
    ready: "Annual billing toggle",
    prepare: async (page) => {
      await page
        .getByRole("button", { name: "Filter", exact: true })
        .first()
        .click();
      await page.getByText("Filter by", { exact: true }).waitFor();
    },
    clip: { x: 316, y: 88, width: 244, height: 772 },
  },
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
      await page.getByRole("button", { name: "List", exact: true }).click();
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
