/**
 * Screenshots for the planning docs (apps/docs/core/functional): backlog,
 * cycles, modules, estimates, views, intake and its sources, project
 * updates, analytics, pages and drafts.
 *
 * LOCAL DEVELOPMENT ONLY. Besides the Studio North seed, these screens need
 * backlog tasks, saved views, intake requests, email intake and a public
 * request form on Mobile app, project updates on Platform API and Mobile app,
 * a saved analytics report, drafts, a sub-page, a page template, page
 * comments and a milestone.
 * ensurePlanningDemo() creates them through the public API the first time and
 * reuses them afterwards. A few shots answer one request in the browser instead,
 * where real data would change the press user's inbox or other shots.
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

const INTAKE_FORM = {
  enabled: true,
  title: "Report a problem with the Mobile app",
  intro:
    "Tell the Mobile app team what went wrong or what you need. We read every request on weekdays.",
  emailField: "required",
  nameField: "optional",
  confirmationMessage:
    "Thanks! The Mobile app team will look at your request this week.",
};

/** Platform API status updates, oldest first; the latest is AI-drafted. */
const PROJECT_UPDATES = [
  {
    health: "on_track",
    summary:
      "The v2 endpoints are on track, and work on the reference docs has started.",
    highlights: "- Cursor pagination on every list endpoint",
    nextSteps: "- Write the reference docs for the new endpoints",
  },
  {
    health: "at_risk",
    summary:
      "The v2 launch is at risk: the reference docs are behind and two endpoints still lack rate limits.",
    highlights:
      "- Webhook retries are live\n- Error responses now share one format",
    blockers:
      "- Public API v2 reference docs are about a week behind\n- Rate limits are missing on the search and export endpoints",
    nextSteps:
      "- Theo pairs with Priya on the docs this week\n- Confirm the launch date at Friday's review",
    aiAssist: { feature: "project_update" },
  },
];
/** What the composer shot's "Draft with AI" fills in. */
const AI_DRAFT = {
  health: "at_risk",
  summary:
    "Most v2 endpoints are done, but the reference docs and rate limits put the launch date at risk.",
  highlights:
    "- Search and export endpoints merged\n- Webhook retries running in production",
  blockers:
    "- Public API v2 reference docs: 4 of 11 pages written\n- Rate limits still missing on export",
  nextSteps:
    "- Finish the docs for the search endpoints\n- Agree the launch date at Friday's review",
};
const UPDATE_REACTIONS = [
  ["priya", "thumbs_up"],
  ["jonas", "thumbs_up"],
  ["sofia", "eyes"],
];
const UPDATE_COMMENT =
  "I can take the rate limits on search tomorrow, so the docs get Priya's full week.";
const MOBILE_UPDATE = {
  health: "on_track",
  summary:
    "Beta 0.9 is with testers, and crash reports are down by half since last week.",
  highlights: "- Push notifications open the right screen",
  nextSteps: "- Ship beta 1.0 to the store review",
};

const TEMPLATE_NAME = "Migration notes";
const REPORT_NAME = "Open work by assignee";
const MILESTONE_TITLE = "Public API v2 launch";
const MILESTONE_BLOCKER = "Public API v2 reference docs";

/** On the Relaunch plan page; the press user's own comment comes last. */
const PAGE_COMMENTS = [
  ["priya", "Can we move the launch checklist above the goals?"],
  ["sofia", "Works for me. I'll add the design sign-off to it."],
  ["press", "Done, thanks both. Let's review it on Friday."],
];

// [name, hours, entries], fictional totals for the Time tab.
const TIME_BY_PERSON = [
  ["Priya Raman", 18, 14],
  ["Elena Marsh", 14.5, 11],
  ["Jonas Weber", 12, 9],
  ["Sofia Duarte", 8, 7],
  ["Theo Okafor", 6, 5],
];
const TIME_BY_PROJECT = [
  ["web", "Website relaunch", "WEB", "Globe", 33, 26],
  ["api", "Platform API", "API", "Server", 16, 12],
  ["mobile", "Mobile app", "MOB", "Smartphone", 9.5, 8],
];

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
  const report =
    reports.find((r) => r.name === REPORT_NAME) ??
    (await press.call("POST", "/analytics-report", {
      workspaceId,
      name: REPORT_NAME,
      visibility: "workspace",
      config: { xAxis: "assignee", segment: "priority", metric: "taskCount" },
    }));

  // A milestone on Platform API, which the reference docs task blocks.
  const platform = bySlug("API");
  const platformBoard = await press.get(`/task/tasks/${platform.id}`, {
    limit: 100,
    page: 1,
  });
  const platformTasks = [
    ...platformBoard.data.columns.flatMap((c) => c.tasks),
    ...platformBoard.data.plannedTasks,
  ];
  const milestone =
    platformTasks.find((t) => t.title === MILESTONE_TITLE) ??
    (await press.call("POST", `/task/${platform.id}`, {
      title: MILESTONE_TITLE,
      description: "",
      priority: "no-priority",
      status: "to-do",
      assigneeIds: [],
      // Within the Month zoom's first screen, so the diamond and its label show.
      startDate: day(5),
      dueDate: day(5),
      isMilestone: true,
    }));
  const blocker = platformTasks.find((t) => t.title === MILESTONE_BLOCKER);
  const milestoneLinks = await press.get(`/task-relation/${milestone.id}`);
  if (blocker && !JSON.stringify(milestoneLinks).includes(blocker.id)) {
    await press.call("POST", "/task-relation", {
      sourceTaskId: blocker.id,
      targetTaskId: milestone.id,
      relationType: "blocks",
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

  // Comments on the relaunch plan. The press user stops watching first, so the
  // others' comments stay out of their inbox, and commenting last watches again.
  if (plan) {
    const comments = asList(
      await press.get(`/page/${plan.id}/comments`),
      "comments",
    );
    if (comments.length === 0) {
      await press.call("DELETE", `/page/${plan.id}/subscription`);
      for (const [who, content] of PAGE_COMMENTS) {
        await s[who].call("POST", `/page/${plan.id}/comments`, { content });
      }
    }
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

  // Intake sources on the mobile project: the forwarding address (the capture
  // server needs INTAKE_EMAIL_ADDRESS) with domain lists, and a public form.
  await press.call("PUT", `/intake-email/project/${mobile.id}`, {
    enabled: true,
    allowedDomains: ["studionorth.example", "northwind-retail.example"],
    blockedDomains: ["newsletters.example"],
  });
  await press.call("PUT", `/intake-form/project/${mobile.id}`, INTAKE_FORM);
  const form = await press.get(`/intake-form/project/${mobile.id}`);

  // Project updates: a history on Platform API and one on Mobile app, for
  // the Updates tab and the Home widget.
  const platformApi = bySlug("API");
  for (const project of [platformApi, mobile]) {
    if (!project.updatesEnabled) {
      await press.call("PATCH", `/project/${project.id}/features`, {
        updatesEnabled: true,
      });
    }
  }
  const apiUpdates = await press.get(
    `/project-update/project/${platformApi.id}`,
  );
  if (apiUpdates.updates.length === 0) {
    const [first, latest] = PROJECT_UPDATES;
    await press.call(
      "POST",
      `/project-update/project/${platformApi.id}`,
      first,
    );
    const posted = await press.call(
      "POST",
      `/project-update/project/${platformApi.id}`,
      latest,
    );
    for (const [who, emoji] of UPDATE_REACTIONS) {
      await s[who].call(
        "PUT",
        `/project-update/${posted.id}/reaction/${emoji}`,
      );
    }
    await s.theo.call("POST", `/project-update/${posted.id}/comment`, {
      content: UPDATE_COMMENT,
    });
  }
  const mobileUpdates = await press.get(`/project-update/project/${mobile.id}`);
  if (mobileUpdates.updates.length === 0) {
    await s.priya.call(
      "POST",
      `/project-update/project/${mobile.id}`,
      MOBILE_UPDATE,
    );
  }
  // Posts and comments notify the press user; archive those so the inbox
  // shots keep their seeded list. Notifications are written just after.
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const inbox = await press.get("/notification/inbox", { workspaceId });
  for (const item of inbox.items ?? []) {
    if (item.type?.startsWith("project_update")) {
      await press.call("PATCH", `/notification/${item.id}/archive`);
    }
  }

  return {
    requestForm: form.path,
    platformApi: platformApi.id,
    workspaceId,
    module: marketing?.id,
    report: report.id,
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

/**
 * Tabs and buttons that depend on permissions appear after the page goes quiet
 * when the machine is busy, so a shot that shows them waits for the last tab.
 */
const waitForCapabilities = (page) =>
  page.getByRole("tab", { name: "Analytics", exact: true }).first().waitFor();

/** Answers the Time tab's requests here, so nobody's inbox hears about entries. */
async function answerTimeReport(page, seed) {
  await page.route(
    (url) => url.pathname === "/api/time-entry/running",
    (route) => route.fulfill({ status: 200, json: { entry: null } }),
  );
  await page.route(
    (url) => url.pathname === "/api/time-entry/report",
    (route) =>
      route.fulfill({
        status: 200,
        json: {
          from: new URL(route.request().url()).searchParams.get("from"),
          to: new URL(route.request().url()).searchParams.get("to"),
          timeZone: "UTC",
          totalSeconds: 58.5 * 3600,
          entryCount: 46,
          runningCount: 1,
          byPerson: TIME_BY_PERSON.map(([name, hours, entryCount]) => ({
            userId: `docs-shot-${name}`,
            name,
            image: null,
            seconds: hours * 3600,
            entryCount,
          })),
          byProject: TIME_BY_PROJECT.map(
            ([key, name, slug, icon, hours, entryCount]) => ({
              projectId: seed.projects[key].id,
              name,
              slug,
              icon,
              seconds: hours * 3600,
              entryCount,
            }),
          ),
        },
      }),
  );
}

/**
 * Adds a link whose dates conflict, in this browser only: the pricing page ends
 * after the task it would block starts. Nothing is saved.
 */
function answerWithBrokenLink(page, seed) {
  const { tasks, id } = seed.projects.web;
  return page.route(
    (url) => url.pathname === `/api/task-relation/project/${id}`,
    async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({
        response,
        json: {
          ...body,
          relations: [
            ...body.relations,
            {
              id: "docs-shot-link",
              sourceTaskId: tasks.pricing.id,
              targetTaskId: tasks.video.id,
              relationType: "blocks",
            },
          ],
        },
      });
    },
  );
}

/** Clicks the red line. Broken lines draw last, and a click can't land on a bar. */
async function openBrokenLine(page) {
  const line = page.getByTestId("gantt-dependency-hit").last();
  await line.waitFor({ state: "attached" });
  const point = await line.evaluate((path) => {
    const middle = path.getPointAtLength(path.getTotalLength() / 2);
    const { x, y } = new DOMPoint(middle.x, middle.y).matrixTransform(
      path.getScreenCTM() ?? undefined,
    );
    return { clientX: x, clientY: y };
  });
  await line.dispatchEvent("click", point);
  await page.getByTestId("gantt-link-popover").waitFor();
}

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
    ready: "Show weekends",
    // The corner the runner parks the pointer in is a day cell, and hovering one
    // shows its add button.
    keepPointer: true,
    prepare: (page) => page.mouse.move(1300, 68),
    clip: content(900),
  },
  {
    name: "views/gantt-layout",
    url: (seed) => `${web(seed)}/views/${demo.views["Release timeline"]}`,
    ready: "Jump to today",
    clip: content(900),
  },
  {
    name: "views/gantt-link-popover",
    url: (seed) => `${web(seed)}/gantt`,
    ready: "Jump to today",
    before: answerWithBrokenLink,
    prepare: openBrokenLine,
    clip: { selector: "[data-testid=gantt-link-popover]", pad: 140 },
  },
  {
    name: "views/gantt-date-cascade",
    url: (seed) => `${web(seed)}/gantt`,
    ready: "Jump to today",
    before: answerWithBrokenLink,
    prepare: async (page) => {
      await openBrokenLine(page);
      await click(page, "Review date changes");
      // Stops at the preview: nothing moves.
      await page.getByTestId("gantt-cascade-preview").waitFor();
    },
    clip: { selector: "[role=alertdialog]", pad: 0 },
  },
  {
    name: "views/gantt-milestone",
    url: (seed) => `${ws(seed)}/project/${seed.projects.api.id}/gantt`,
    ready: "Jump to today",
    prepare: async (page) => {
      await page
        .getByRole("button", {
          name: `Milestone ${MILESTONE_TITLE}: open or drag to move`,
        })
        .waitFor();
      await waitForCapabilities(page);
      await page
        .getByRole("button", { name: "Milestone", exact: true })
        .waitFor();
    },
    clip: content(574),
  },
  {
    name: "views/workspace-timeline",
    url: (seed) => `${ws(seed)}/views`,
    ready: "Display",
    prepare: async (page) => {
      await click(page, "Gantt");
      await page.getByRole("heading", { name: "Mobile app" }).waitFor();
      await page
        .getByRole("button", { name: "Save view", exact: true })
        .waitFor();
    },
    // Tall enough for the first three projects' sections; ends between two rows.
    viewport: { width: 1440, height: 1230 },
    clip: content(1208),
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

  // Intake sources and the public request form
  {
    name: "intake/intake-sources-email",
    url: (seed) =>
      `/dashboard/settings/projects/${seed.projects.mobile.id}/intake`,
    ready: "Forwarding address",
    // The address and the domain lists, down to the size limits; the
    // optional project mailbox below has its own paragraph in the docs.
    prepare: async (page) => {
      await page.evaluate(() => {
        const heading = [...document.querySelectorAll("h2")].find(
          (h) => h.textContent?.trim() === "Email",
        );
        const section = heading?.closest("section");
        const note = [...(section?.querySelectorAll("p") ?? [])].find((p) =>
          p.textContent?.startsWith("Messages over"),
        );
        if (!section || !note) throw new Error("No Email section");
        const outer = section.getBoundingClientRect();
        const box = document.createElement("div");
        box.setAttribute("data-docs-shot-box", "");
        Object.assign(box.style, {
          position: "fixed",
          left: `${outer.left - 12}px`,
          top: `${outer.top - 12}px`,
          width: `${outer.width + 24}px`,
          height: `${note.getBoundingClientRect().bottom - outer.top + 24}px`,
          pointerEvents: "none",
        });
        document.body.append(box);
      });
    },
    clip: { selector: "[data-docs-shot-box]" },
    viewport: { width: 1440, height: 1400 },
  },
  {
    name: "intake/intake-sources-form",
    url: (seed) =>
      `/dashboard/settings/projects/${seed.projects.mobile.id}/intake`,
    ready: "Forwarding address",
    prepare: async (page) => {
      await page
        .locator('section:has(h2:text-is("Request form"))')
        .scrollIntoViewIfNeeded();
      // The link starts with the capture server's address; show a public one.
      await page.evaluate(() => {
        for (const input of document.querySelectorAll("input")) {
          if (input.value.includes("/request-form/")) {
            input.value = input.value.replace(
              /^https?:\/\/[^/]+/,
              "https://margaya.studionorth.example",
            );
          }
        }
      });
    },
    clip: { selector: 'section:has(h2:text-is("Request form"))', pad: 12 },
    viewport: { width: 1440, height: 2000 },
  },
  {
    name: "intake/public-request-form",
    url: () => demo.requestForm,
    ready: "Report a problem with the Mobile app",
    // Filled for the picture and never sent.
    prepare: async (page) => {
      await page
        .getByLabel("Title")
        .fill("The app logs me out after every update");
      await page
        .getByLabel(/email/i)
        .first()
        .fill("sam@northwind-retail.example");
      await markUnion(page, [
        page.getByRole("heading", {
          name: "Report a problem with the Mobile app",
        }),
        page.getByLabel("Title"),
        page.getByRole("button", { name: "Send request" }),
      ]);
    },
    clip: { selector: "[data-docs-shot-box]", pad: 32 },
    viewport: { width: 1440, height: 1000 },
  },

  // Project updates
  {
    name: "project-updates/timeline",
    url: (seed) => `${ws(seed)}/project/${demo.platformApi}/updates`,
    ready: "The v2 launch is at risk",
    prepare: async (page) => {
      const latest = page.getByLabel("Update by Elena Marsh").first();
      await latest.getByText(/^Data at posting/).click();
      await latest
        .getByText(/^Forecast|^Overdue|^Blocked|^Completed/)
        .first()
        .waitFor();
      // The content column from the top bar down to the latest update.
      const card = await latest.boundingBox();
      await page.evaluate(
        ([left, height]) => {
          document.querySelector("[data-docs-shot-box]")?.remove();
          const box = document.createElement("div");
          box.setAttribute("data-docs-shot-box", "");
          Object.assign(box.style, {
            position: "fixed",
            left: `${left}px`,
            top: "0px",
            width: `${window.innerWidth - left}px`,
            height: `${height}px`,
            pointerEvents: "none",
          });
          document.body.append(box);
        },
        [CONTENT, Math.ceil(card.y + card.height + 16)],
      );
    },
    clip: { selector: "[data-docs-shot-box]" },
    viewport: { width: 1440, height: 1400 },
  },
  {
    name: "project-updates/composer",
    url: (seed) => `${ws(seed)}/project/${demo.platformApi}/updates`,
    ready: "The v2 launch is at risk",
    // The AI draft is answered here: no AI provider is needed, and the facts
    // under it are the server's own.
    before: async (page) => {
      await page.route(
        (url) => url.pathname === "/api/ai/availability",
        (route) =>
          route.fulfill({
            status: 200,
            json: {
              available: true,
              instanceEnabled: true,
              configured: true,
              workspaceEnabled: true,
              projectEnabled: true,
              canUse: true,
              canManage: true,
              destination: "cloud",
              provider: "anthropic",
              zeroRetention: false,
              requireApprovalForWrites: false,
              autoTranslateComments: false,
            },
          }),
      );
      await page.route(
        (url) => url.pathname.endsWith("/draft"),
        async (route) => {
          if (route.request().method() !== "POST") return route.fallback();
          const response = await route.fetch();
          const body = await response.json();
          await route.fulfill({
            response,
            json: {
              ...body,
              aiDrafted: true,
              aiUnavailable: null,
              draft: AI_DRAFT,
            },
          });
        },
      );
    },
    prepare: async (page) => {
      await click(page, "New update");
      await click(page, "Draft with AI");
      await page.getByText("AI-generated").first().waitFor();
    },
    clip: { selector: 'form[aria-label="New project update"]', pad: 8 },
    viewport: { width: 1440, height: 1400 },
  },
  {
    name: "home/project-updates-widget",
    url: (seed) => ws(seed),
    ready: "Project updates",
    // Answered here, so the widget isn't turned on for every other shot of Home.
    before: (page, seed) =>
      page.route(
        (url) => url.pathname === "/api/home/preferences",
        (route) =>
          route.request().method() === "GET"
            ? route.fulfill({
                status: 200,
                json: {
                  workspaceId: seed.workspace.id,
                  updatedAt: null,
                  widgets: [
                    { key: "project-updates", enabled: true },
                    { key: "quick-links", enabled: true },
                    { key: "recents", enabled: true },
                    { key: "stickies", enabled: true },
                    { key: "risks", enabled: false },
                    { key: "my-brief", enabled: false },
                    { key: "pinned-reports", enabled: false },
                  ],
                },
              })
            : route.fallback(),
      ),
    prepare: async (page) => {
      const widget = page.getByRole("region", { name: "Project updates" });
      await widget
        .getByText("Beta 0.9 is with testers", { exact: false })
        .waitFor();
      await widget.evaluate((el) => el.setAttribute("data-docs-shot", ""));
    },
    clip: { selector: "[data-docs-shot]", pad: 0 },
    viewport: { width: 1440, height: 1200 },
  },

  // Analytics
  {
    name: "analytics/overview",
    url: (seed) => `${ws(seed)}/analytics`,
    ready: "Workload",
    // Tile labels wrap onto two lines; ends below the Workload chart's last row.
    clip: content(845),
  },
  {
    name: "analytics/workload",
    url: (seed) => `${ws(seed)}/analytics`,
    ready: "Workload",
    viewport: { width: 1440, height: 1700 },
    prepare: async (page) => {
      await page.getByText(/^Usual is what each person/).waitFor();
      await markCard(page, "Workload", [
        "Workload",
        "Usual is what each person",
      ]);
      await page
        .locator("[data-docs-shot]")
        .getByRole("button", { name: "Table" })
        .click();
      await page.getByText("Against usual").first().waitFor();
    },
    clip: { selector: "[data-docs-shot]", pad: 0 },
  },
  {
    name: "analytics/time-report",
    url: (seed) => `${ws(seed)}/analytics?tab=time`,
    ready: "By person",
    before: answerTimeReport,
    clip: content(560),
  },
  {
    name: "analytics/home-pinned-report",
    url: (seed) => ws(seed),
    ready: "Pinned reports",
    // Answered here, so the report isn't pinned for every other shot of Home.
    before: (page, seed) =>
      page.route(
        (url) => url.pathname === "/api/home/preferences",
        (route) =>
          route.request().method() === "GET"
            ? route.fulfill({
                status: 200,
                json: {
                  workspaceId: seed.workspace.id,
                  updatedAt: null,
                  widgets: [
                    {
                      key: "pinned-reports",
                      enabled: true,
                      reportIds: [demo.report],
                    },
                    { key: "quick-links", enabled: true },
                    { key: "recents", enabled: true },
                    { key: "stickies", enabled: true },
                    { key: "risks", enabled: false },
                    { key: "my-brief", enabled: false },
                  ],
                },
              })
            : route.fallback(),
      ),
    prepare: async (page) => {
      const widget = page.getByRole("region", { name: "Pinned reports" });
      await widget.getByRole("img").first().waitFor();
      await widget.evaluate((el) => el.setAttribute("data-docs-shot", ""));
    },
    clip: { selector: "[data-docs-shot]", pad: 0 },
    viewport: { width: 1440, height: 1200 },
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
    name: "pages/page-comments",
    url: (seed) => `${web(seed)}/pages/${seed.projects.web.page.id}`,
    ready: "Pricing page signed off",
    prepare: async (page) => {
      await page.getByRole("button", { name: /panel/i }).last().click();
      await page.getByRole("tab", { name: "Comments" }).first().click();
      await page.getByText(PAGE_COMMENTS[2][1]).first().waitFor();
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
