/**
 * Screenshots for the planning docs (apps/docs/core/functional): backlog,
 * cycles, modules, estimates, views, intake, analytics, pages and drafts.
 *
 * LOCAL DEVELOPMENT ONLY. Besides the Studio North seed, these screens need
 * backlog tasks, saved views, intake requests, a saved analytics report,
 * drafts, a sub-page and a page template. ensurePlanningDemo() creates them
 * through the public API the first time and reuses them afterwards.
 */

process.env.PRESS_API_URL ??= "http://127.0.0.1:1337";
process.env.PRESS_CLIENT_URL ??= "http://localhost:5173";
const { DEMO_USERS, DEMO_WORKSPACE, signIn } = await import(
  "../../press/seed-demo.mjs"
);

const BACKLOG = [
  ["Plan the Q1 content calendar", "high", "priya", "Docs"],
  ["Audit redirects after the CMS migration", "medium", "jonas", "Backend"],
  ["Explore a dark theme for the blog", "low", "sofia", "Design"],
  ["Interview three customers about pricing", "medium", "press", "Research"],
];

const REQUESTS = [
  [
    "jonas",
    "App crashes when opening a push notification",
    "Happens on Android 15 when the app was closed. Steps: close the app, send a test push, tap it.",
    "urgent",
  ],
  [
    "sofia",
    "Add haptic feedback to pull-to-refresh",
    "A light tap when the refresh starts would make it feel native on iOS.",
    "low",
  ],
  [
    "theo",
    "Support landscape mode on tablets",
    "Sales demos run on iPads in landscape. The board view is cut off there.",
    "medium",
  ],
  [
    "priya",
    "Show the build number in Settings",
    "Support asks for it on every ticket.",
    "high",
  ],
];

const DRAFTS = [
  {
    title: "Write release notes for Sprint 14",
    project: "web",
    priority: "high",
    description: "Pricing, customer stories and the new hero.",
  },
  {
    title: "Collect feedback on the new pricing page",
    project: "web",
    priority: "medium",
  },
  {
    title: "Ideas for the app store screenshots",
    project: "mobile",
    priority: "low",
  },
  {
    title: "Agenda for the team offsite",
    project: null,
    priority: "no-priority",
  },
];

const SUB_PAGE = {
  title: "Content migration notes",
  emoji: "📦",
  markdown: [
    "Notes for moving the blog and customer stories into the new CMS.",
    "",
    "## Scope",
    "",
    "- 240 blog posts, 18 customer stories",
    "- Redirects for every old URL",
    "",
    "## Open questions",
    "",
    "1. Do we keep comments on old posts?",
    "2. Who signs off the German copy?",
    "",
    "## Timeline",
    "",
    "Migration runs during Sprint 15 and finishes before launch.",
  ].join("\n"),
};

const TEMPLATE_NAME = "Migration notes";
const REPORT_NAME = "Open work by assignee";

function day(offset) {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString();
}

const asList = (body, key) =>
  Array.isArray(body) ? body : (body?.[key] ?? []);

async function ensurePlanningDemo() {
  const s = {};
  for (const key of Object.keys(DEMO_USERS)) {
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
  const projects = await press.get("/project", { workspaceId });
  const bySlug = (slug) => projects.find((p) => p.slug === slug);
  const web = bySlug("WEB");
  const mobile = bySlug("MOB");
  if (!web || !mobile) throw new Error("Run scripts/press/seed-demo.mjs first");
  const labels = await press.get(`/label/workspace/${workspaceId}`);
  const labelId = (name) =>
    labels.find((l) => l.taskId === null && l.name === name)?.id;

  // Backlog: planned tasks on the website project.
  const board = await press.get(`/task/tasks/${web.id}`, {
    limit: 100,
    page: 1,
  });
  const allTasks = [
    ...board.data.columns.flatMap((c) => c.tasks),
    ...board.data.plannedTasks,
  ];
  for (const [title, priority, who, label] of BACKLOG) {
    if (allTasks.some((t) => t.title === title)) continue;
    const task = await press.call("POST", `/task/${web.id}`, {
      title,
      description: "",
      priority,
      status: "planned",
      assigneeIds: [s[who].id],
    });
    if (labelId(label)) {
      await press.call("PUT", `/label/${labelId(label)}/task`, {
        taskId: task.id,
      });
    }
  }

  // Saved views on the website project, plus one workspace view.
  const projectViews = asList(
    await press.get("/view", { workspaceId, projectId: web.id }),
    "views",
  );
  const viewSpecs = [
    {
      name: "Due this week",
      description: "Everything due before Friday's demo.",
      filters: {
        root: {
          op: "and",
          children: [{ key: "dueDate", operator: "in", values: ["thisWeek"] }],
        },
      },
      display: { layout: "list", groupBy: "assignee" },
    },
    {
      name: "Design review",
      filters: {
        root: {
          op: "and",
          children: [{ key: "label", operator: "in", values: ["name:Design"] }],
        },
      },
      display: { layout: "board" },
    },
    { name: "Launch calendar", display: { layout: "calendar" } },
    { name: "Release timeline", display: { layout: "gantt" } },
  ];
  const views = {};
  for (const spec of viewSpecs) {
    views[spec.name] =
      projectViews.find((v) => v.name === spec.name) ??
      (await press.call("POST", "/view", {
        workspaceId,
        projectId: web.id,
        access: "workspace",
        ...spec,
      }));
  }

  // Intake on the mobile project, with requests from several people.
  if (!mobile.intakeEnabled) {
    await press.call("PATCH", `/project/${mobile.id}/features`, {
      intakeEnabled: true,
    });
  }
  const open = await press.get(`/intake/project/${mobile.id}`, {
    tab: "open",
    status: "pending,snoozed",
  });
  const closed = await press.get(`/intake/project/${mobile.id}`, {
    tab: "closed",
  });
  const requestTitles = [...open.items, ...closed.items].map(
    (i) => i.task?.title ?? i.title,
  );
  for (const [who, title, description, priority] of REQUESTS) {
    if (requestTitles.includes(title)) continue;
    await s[who].call("POST", `/intake/project/${mobile.id}`, {
      title,
      description,
      priority,
    });
  }

  // A saved analytics report shared with the workspace.
  const reports = asList(
    await press.get("/analytics-report", { workspaceId }),
    "reports",
  );
  if (!reports.some((r) => r.name === REPORT_NAME)) {
    await press.call("POST", "/analytics-report", {
      workspaceId,
      name: REPORT_NAME,
      visibility: "workspace",
      config: { xAxis: "assignee", segment: "priority", metric: "taskCount" },
    });
  }

  // Drafts belong to the press user only.
  const drafts = asList(
    await press.get("/task-draft", { workspaceId }),
    "drafts",
  );
  const projectIds = { web: web.id, mobile: mobile.id };
  for (const draft of DRAFTS) {
    if (drafts.some((d) => d.title === draft.title)) continue;
    await press.call("POST", "/task-draft", {
      workspaceId,
      title: draft.title,
      priority: draft.priority,
      ...(draft.description ? { description: draft.description } : {}),
      ...(draft.project ? { projectId: projectIds[draft.project] } : {}),
      ...(draft.project === "web"
        ? { dueDate: day(5), assigneeIds: [s.press.id] }
        : {}),
    });
  }

  // Pages: a sub-page under the relaunch plan, saved as a project template.
  const pages = asList(await press.get(`/page/project/${web.id}`), "pages");
  const plan = pages.find((p) => p.title === "Relaunch plan");
  let subPage = pages.find((p) => p.title === SUB_PAGE.title);
  if (!subPage && plan) {
    subPage = await press.call("POST", `/page/project/${web.id}`, {
      title: SUB_PAGE.title,
      logoKind: "emoji",
      logoValue: SUB_PAGE.emoji,
      content: SUB_PAGE.markdown,
      parentId: plan.id,
    });
  }
  const templates = asList(
    await press.get(`/page/project/${web.id}/templates`),
    "templates",
  );
  if (subPage && !JSON.stringify(templates).includes(TEMPLATE_NAME)) {
    await press.call("POST", `/page/${subPage.id}/template`, {
      name: TEMPLATE_NAME,
      scope: "project",
    });
  }

  // The publish dialog needs public pages on for the workspace.
  const settings = await press.get(`/workspace/${workspaceId}/settings`);
  if (!settings.allowPublicPages) {
    await press.call("PATCH", `/workspace/${workspaceId}/settings`, {
      allowPublicPages: true,
    });
  }

  const modules = asList(
    await press.get(`/module/project/${web.id}`, { view: "active" }),
    "modules",
  );
  const marketing = modules.find((m) => m.name === "Marketing site");

  return {
    workspaceId,
    module: marketing?.id,
    web: web.id,
    mobile: mobile.id,
    plan: plan?.id,
    subPage: subPage?.id,
    views: Object.fromEntries(
      Object.entries(views).map(([name, v]) => [name, v.id]),
    ),
  };
}

export const demo = await ensurePlanningDemo();

// The app sidebars take the first 312 CSS pixels at the default 1440 width.
const CONTENT = 312;

const ws = (seed) => `/dashboard/workspace/${seed.workspace.id}`;
const web = (seed) => `${ws(seed)}/project/${seed.projects.web.id}`;
const mobile = (seed) => `${ws(seed)}/project/${seed.projects.mobile.id}`;
const projectSettings = (seed, tab) =>
  `/dashboard/settings/projects/${seed.projects.web.id}/${tab}`;
const content = (height, y = 0) => ({
  x: CONTENT,
  y,
  width: 1440 - CONTENT,
  height,
});

/**
 * Marks the closest ancestor of the element showing `text` whose text also
 * contains every one of `needles`, so a shot can clip to it.
 */
async function markCard(page, text, needles) {
  const target = page.getByText(text, { exact: true }).first();
  await target.scrollIntoViewIfNeeded();
  await target.evaluate((el, needles) => {
    for (const old of document.querySelectorAll("[data-docs-shot]")) {
      old.removeAttribute("data-docs-shot");
    }
    let node = el;
    while (
      node.parentElement &&
      !needles.every((n) => node.textContent.includes(n))
    ) {
      node = node.parentElement;
    }
    node.setAttribute("data-docs-shot", "");
  }, needles);
}

/** Puts an invisible box over the union of the given locators, for clipping. */
async function markUnion(page, locators) {
  const boxes = [];
  for (const locator of locators) {
    const box = await locator.first().boundingBox();
    if (box) boxes.push(box);
  }
  const left = Math.min(...boxes.map((b) => b.x));
  const top = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  await page.evaluate(
    ([left, top, width, height]) => {
      document.querySelector("[data-docs-shot-box]")?.remove();
      const box = document.createElement("div");
      box.setAttribute("data-docs-shot-box", "");
      Object.assign(box.style, {
        position: "fixed",
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
        pointerEvents: "none",
      });
      document.body.append(box);
    },
    [left, top, right - left, bottom - top],
  );
}

const click = (page, name, options = {}) =>
  page
    .getByRole("button", { name, exact: true, ...options })
    .first()
    .click();

const dialog = { selector: "[role=dialog]", pad: 16 };

export default [
  // Backlog
  {
    name: "backlog/backlog-view",
    url: (seed) => `${web(seed)}/backlog`,
    ready: "Plan the Q1 content calendar",
    clip: content(306),
  },

  // Cycles
  {
    name: "cycles/new-cycle-dialog",
    url: (seed) => `${web(seed)}/cycles`,
    ready: "Sprint 14",
    prepare: async (page) => {
      await click(page, "New cycle");
      const form = page.getByRole("dialog");
      await form.getByRole("textbox").first().fill("Sprint 16");
      await form
        .getByRole("textbox")
        .nth(1)
        .fill("Launch week: redirects, monitoring and the release notes.");
    },
    clip: dialog,
  },
  {
    name: "cycles/cycle-list",
    url: (seed) => `${web(seed)}/cycles`,
    ready: "Burndown",
    clip: content(670),
  },
  {
    name: "cycles/cycle-detail",
    url: (seed) =>
      `${web(seed)}/cycles/${seed.projects.web.cycles["Sprint 14"].id}`,
    ready: "Tasks left",
    clip: content(900),
  },
  {
    name: "cycles/rollover-setting",
    url: (seed) => projectSettings(seed, "workflow"),
    ready: "Workflow",
    prepare: async (page) => {
      await markCard(page, "Scheduled automations", [
        "Scheduled automations",
        "Roll over unfinished cycle work",
      ]);
    },
    clip: { selector: "[data-docs-shot]", pad: 16 },
  },

  // Modules
  {
    name: "modules/module-list",
    url: (seed) => `${web(seed)}/modules`,
    ready: "Marketing site",
    clip: content(290),
  },
  {
    name: "modules/new-module-dialog",
    url: (seed) => `${web(seed)}/modules`,
    ready: "Marketing site",
    prepare: async (page) => {
      await click(page, "New module");
      const form = page.getByRole("dialog");
      await form.getByRole("textbox").first().fill("Customer stories");
      await form
        .getByRole("textbox")
        .nth(1)
        .fill("Interviews, write-ups and the stories index page.");
    },
    clip: dialog,
  },
  {
    name: "modules/module-detail",
    url: (seed) => `${web(seed)}/modules/${demo.module}`,
    ready: "Marketing site",
    clip: content(900),
  },

  // Estimates
  {
    name: "estimates/estimate-system",
    url: (seed) => projectSettings(seed, "estimates"),
    ready: "Estimate system",
    prepare: async (page) => {
      await markCard(page, "Estimate system", ["Estimate system", "Add"]);
    },
    clip: { selector: "[data-docs-shot]", pad: 16 },
  },
  {
    name: "estimates/new-system-dialog",
    url: (seed) => projectSettings(seed, "estimates"),
    ready: "Estimate system",
    prepare: async (page) => {
      await page.locator('[aria-label="Estimate system actions"]').click();
      await page.getByRole("menuitem", { name: "New system" }).click();
    },
    clip: dialog,
  },

  // Views
  {
    name: "views/filter-menu",
    url: (seed) => `${web(seed)}/board`,
    ready: "Annual billing toggle",
    prepare: async (page) => {
      await click(page, "Filter");
      await markUnion(page, [
        page.getByRole("button", { name: "Filter", exact: true }),
        page.getByRole("menu"),
      ]);
    },
    clip: { selector: "[data-docs-shot-box]", pad: 12 },
  },
  {
    name: "views/display-menu",
    url: (seed) => `${web(seed)}/board`,
    ready: "Annual billing toggle",
    prepare: async (page) => {
      await click(page, "Display");
      await markUnion(page, [
        page.getByRole("button", { name: "Display", exact: true }),
        page.getByRole("dialog"),
      ]);
    },
    clip: { selector: "[data-docs-shot-box]", pad: 12 },
  },
  {
    name: "views/save-view-dialog",
    url: (seed) => `${web(seed)}/board`,
    ready: "Annual billing toggle",
    prepare: async (page) => {
      await click(page, "Filter");
      await page.getByRole("menuitem", { name: "Priority" }).first().click();
      await page.waitForTimeout(500);
      await page.getByText("High", { exact: true }).first().click();
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await click(page, "Save view");
      await page
        .getByRole("dialog")
        .getByRole("textbox")
        .first()
        .fill("High priority work");
    },
    clip: dialog,
  },
  {
    name: "views/views-list",
    url: (seed) => `${web(seed)}/views`,
    ready: "Release timeline",
    clip: content(320),
  },
  {
    name: "views/saved-view",
    url: (seed) => `${web(seed)}/views/${demo.views["Due this week"]}`,
    ready: "Write the pricing FAQ",
    clip: content(575),
  },
  {
    name: "views/calendar-layout",
    url: (seed) => `${web(seed)}/views/${demo.views["Launch calendar"]}`,
    ready: "October",
    clip: content(900),
  },
  {
    name: "views/gantt-layout",
    url: (seed) => `${web(seed)}/views/${demo.views["Release timeline"]}`,
    ready: "Jump to today",
    clip: content(900),
  },

  // Intake
  {
    name: "intake/intake-queue",
    url: (seed) => `${mobile(seed)}/intake`,
    ready: "App crashes when opening a push notification",
    prepare: async (page) => {
      await page.getByText("Show the build number in Settings").first().click();
      await page.getByText("submitted this request").first().waitFor();
    },
    clip: content(620),
  },
  {
    name: "intake/new-request-dialog",
    url: (seed) => `${mobile(seed)}/intake`,
    ready: "App crashes when opening a push notification",
    prepare: async (page) => {
      await click(page, "New request");
    },
    clip: dialog,
  },
  {
    name: "intake/accept-request",
    url: (seed) => `${mobile(seed)}/intake`,
    ready: "App crashes when opening a push notification",
    prepare: async (page) => {
      await page.getByText("Show the build number in Settings").first().click();
      await page.getByText("submitted this request").first().waitFor();
      await click(page, "Accept");
    },
    clip: dialog,
  },

  // Analytics
  {
    name: "analytics/overview",
    url: (seed) => `${ws(seed)}/analytics`,
    ready: "Workload",
    clip: content(810),
  },
  {
    name: "analytics/tasks-tab",
    url: (seed) => `${web(seed)}/analytics`,
    ready: "Created vs completed",
    clip: content(690),
  },
  {
    name: "analytics/saved-report",
    url: (seed) => `${ws(seed)}/analytics`,
    ready: "Workload",
    prepare: async (page) => {
      await page.getByRole("tab", { name: "Tasks" }).first().click();
      await page.getByText("Custom chart").first().waitFor();
      await click(page, "Reports");
      await page.getByText(REPORT_NAME).first().click();
      await page.waitForTimeout(1500);
      const note = page.getByText("A task with several assignees counts once");
      await note.first().scrollIntoViewIfNeeded();
      await markUnion(page, [
        page.getByText("Custom chart", { exact: true }),
        page.getByRole("button", { name: "Export CSV" }),
        note,
      ]);
    },
    clip: { selector: "[data-docs-shot-box]", pad: 14 },
    viewport: { width: 1440, height: 1200 },
  },
  {
    name: "analytics/save-report-dialog",
    url: (seed) => `${ws(seed)}/analytics`,
    ready: "Workload",
    prepare: async (page) => {
      await page.getByRole("tab", { name: "Tasks" }).first().click();
      await page.getByText("Custom chart").first().waitFor();
      await click(page, "Save");
    },
    clip: dialog,
  },

  // Pages
  {
    name: "pages/pages-list",
    url: (seed) => `${web(seed)}/pages`,
    ready: "Content migration notes",
    clip: content(240),
  },
  {
    name: "pages/editor",
    url: (seed) => `${web(seed)}/pages/${seed.projects.web.page.id}`,
    ready: "Pricing page signed off",
    clip: content(640),
  },
  {
    name: "pages/side-panel",
    url: (seed) => `${web(seed)}/pages/${seed.projects.web.page.id}`,
    ready: "Pricing page signed off",
    prepare: async (page) => {
      await page.getByRole("button", { name: /panel/i }).last().click();
      await page.getByRole("tab", { name: "Outline" }).first().waitFor();
    },
    clip: content(640),
  },
  {
    name: "pages/page-menu",
    url: (seed) => `${web(seed)}/pages/${seed.projects.web.page.id}`,
    ready: "Pricing page signed off",
    prepare: async (page) => {
      await page.locator('[aria-label="Page actions"]').click();
      await markUnion(page, [
        page.locator('[aria-label="Page actions"]'),
        page.getByRole("menu"),
      ]);
    },
    clip: { selector: "[data-docs-shot-box]", pad: 12 },
  },
  {
    name: "pages/template-picker",
    url: (seed) => `${web(seed)}/pages`,
    ready: "Content migration notes",
    prepare: async (page) => {
      await page.locator('[aria-label="More ways to create a page"]').click();
      await page
        .getByRole("menuitem", { name: "New page from template" })
        .click();
      await page.getByText(TEMPLATE_NAME).first().waitFor();
    },
    clip: dialog,
  },
  {
    name: "pages/publish-dialog",
    url: (seed) => `${web(seed)}/pages/${seed.projects.web.page.id}`,
    ready: "Pricing page signed off",
    prepare: async (page) => {
      await page.locator('[aria-label="Page actions"]').click();
      await page.getByRole("menuitem", { name: "Publish to web" }).click();
      await page.getByText("Public link").first().waitFor();
    },
    clip: dialog,
  },

  // Drafts
  {
    name: "drafts/drafts-list",
    url: (seed) => `${ws(seed)}/drafts`,
    ready: "Write release notes for Sprint 14",
    clip: content(290),
  },
  {
    name: "drafts/save-as-draft",
    url: (seed) => `${ws(seed)}/drafts`,
    ready: "Write release notes for Sprint 14",
    prepare: async (page) => {
      await click(page, "New draft");
      const form = page.getByRole("dialog");
      await form.getByRole("textbox").first().fill("Update the press kit");
    },
    clip: dialog,
  },
];
