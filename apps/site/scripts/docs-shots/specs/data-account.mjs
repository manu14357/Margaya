/**
 * Screenshots for the data and account docs (apps/docs/core/functional):
 * imports, exports, archives, trash, audit log, webhooks and the account
 * settings pages.
 *
 * LOCAL DEVELOPMENT ONLY. Besides the Studio North seed, these screens need
 * archived and deleted work, webhooks with deliveries, an export and API keys.
 * ensureDataDemo() creates them through the public API the first time and
 * reuses them afterwards. Import previews read small sample files built
 * below; only the CSV result shot really imports, into a throwaway project
 * of the owner account's own workspace, never into Studio North.
 */

process.env.PRESS_API_URL ??= "http://127.0.0.1:1337";
process.env.PRESS_CLIENT_URL ??= "http://localhost:5173";
const { API_URL, CLIENT_URL, DEMO_USERS, DEMO_WORKSPACE, signIn } =
  await import("../../press/seed-demo.mjs");

const OWNER = { email: "owner@margaya.test", password: "Margaya-Owner-2026!" };
const DEMO_PASSWORD = "Margaya-Press-Demo-2026!";
const SANDBOX = { name: "Docs import sandbox", slug: "DIS" };

const ARCHIVED_TASKS = {
  web: [
    "Retire the legacy pricing PDF",
    "Remove the 2025 holiday banner",
    "Clean up old A/B test variants",
  ],
  mobile: ["Drop the iOS 15 support notes"],
};
const ARCHIVED_PROJECT = {
  name: "Brand refresh 2024",
  slug: "BRF",
  icon: "Palette",
  tasks: ["Final logo files", "Brand book PDF", "Social media kit"],
};
const TRASHED_PROJECT = {
  name: "Spring campaign 2025",
  slug: "SPC",
  icon: "Megaphone",
  tasks: ["Landing page copy", "Paid social budget", "Launch email"],
};
const TRASHED_TASKS = [
  ["Old footer link audit", []],
  ["Cookie banner copy", ["Draft the consent text", "Review with legal"]],
];
const WEBHOOKS = [
  {
    name: "Release notifier",
    url: "https://203.0.113.24/hooks/margaya-release",
    events: ["task.created", "task.status_changed", "cycle.*"],
  },
  {
    name: "Support desk sync",
    url: "https://203.0.113.25/hooks/margaya-support",
    events: ["comment.created", "intake.*"],
  },
];
const API_KEYS = [
  {
    name: "CI pipeline",
    expiresIn: 90 * 24 * 3600,
    access: "custom",
    areas: { task: "write", project: "read" },
    projects: ["web"],
  },
  { name: "Weekly report", expiresIn: null, access: "read" },
];

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

const asList = (body, key) =>
  Array.isArray(body) ? body : (body?.[key] ?? body?.items ?? []);

async function ensureDataDemo() {
  const press = await signIn(DEMO_USERS.press);
  const workspace = (await press.get("/auth/organization/list")).find(
    (w) => w.name === DEMO_WORKSPACE.name,
  );
  if (!workspace) throw new Error("Run scripts/press/seed-demo.mjs first");
  const workspaceId = workspace.id;
  await press.call("POST", "/auth/organization/set-active", {
    organizationId: workspaceId,
  });
  const projects = await press.get("/project", {
    workspaceId,
    includeArchived: "true",
  });
  const bySlug = (slug) =>
    projects.find((p) => p.slug.toLowerCase() === slug.toLowerCase());
  const web = bySlug("WEB");
  const mobile = bySlug("MOB");

  // Archived tasks, created for this purpose so no board shot loses a task.
  for (const [key, titles] of Object.entries(ARCHIVED_TASKS)) {
    const project = key === "web" ? web : mobile;
    const existing = await listTasks(press, project.id);
    for (const title of titles) {
      let task = existing.find((t) => t.title === title);
      task ??= await press.call("POST", `/task/${project.id}`, {
        title,
        description: "",
        priority: "low",
        status: "done",
        assigneeIds: [],
      });
      if (!task.archivedAt && !task.isArchived) {
        await press.request("POST", `/task/archive/${task.id}`);
      }
    }
  }

  // An archived project.
  let archivedProject = bySlug(ARCHIVED_PROJECT.slug);
  if (!archivedProject) {
    archivedProject = await press.call("POST", "/project", {
      name: ARCHIVED_PROJECT.name,
      workspaceId,
      icon: ARCHIVED_PROJECT.icon,
      slug: ARCHIVED_PROJECT.slug,
    });
    for (const title of ARCHIVED_PROJECT.tasks) {
      await press.call("POST", `/task/${archivedProject.id}`, {
        title,
        description: "",
        priority: "medium",
        status: "done",
        assigneeIds: [],
      });
    }
  }
  if (!archivedProject.archivedAt) {
    await press.call("PUT", `/project/${archivedProject.id}/archive`);
  }

  // Deleted tasks (one with sub-tasks) in Website relaunch's trash.
  const trashed = asList(
    await press.get(`/trash/project/${web.id}/tasks`),
    "items",
  );
  for (const [title, subtasks] of TRASHED_TASKS) {
    if (trashed.some((t) => t.title === title)) continue;
    const task = await press.call("POST", `/task/${web.id}`, {
      title,
      description: "",
      priority: "low",
      status: "to-do",
      assigneeIds: [],
    });
    for (const sub of subtasks) {
      await press.call("POST", `/task/${web.id}`, {
        title: sub,
        description: "",
        priority: "low",
        status: "to-do",
        assigneeIds: [],
        parentId: task.id,
      });
    }
    await press.call("DELETE", `/task/${task.id}`);
  }

  // A deleted project in the workspace trash.
  const trashedProjects = asList(
    await press.get("/trash/projects", { workspaceId }),
    "items",
  );
  if (!trashedProjects.some((p) => p.name === TRASHED_PROJECT.name)) {
    const project = await press.call("POST", "/project", {
      name: TRASHED_PROJECT.name,
      workspaceId,
      icon: TRASHED_PROJECT.icon,
      slug: TRASHED_PROJECT.slug,
    });
    for (const title of TRASHED_PROJECT.tasks) {
      await press.call("POST", `/task/${project.id}`, {
        title,
        description: "",
        priority: "medium",
        status: "to-do",
        assigneeIds: [],
      });
    }
    await press.call("DELETE", `/project/${project.id}`);
  }

  // Webhooks, each with a test delivery in its log.
  const hooks = asList(await press.get("/webhook", { workspaceId }), "items");
  const webhookIds = {};
  for (const spec of WEBHOOKS) {
    let hook = hooks.find((h) => h.name === spec.name);
    if (!hook) {
      const created = await press.call("POST", "/webhook", {
        workspaceId,
        ...spec,
      });
      hook = created.webhook ?? created;
      await press.request("POST", `/webhook/${hook.id}/test`);
    }
    webhookIds[spec.name] = hook.id;
  }

  // Two finished exports for the history table.
  const exports = asList(
    await press.get("/task-export", { workspaceId }),
    "items",
  );
  if (exports.length === 0) {
    await press.call("POST", "/task-export", { workspaceId, format: "csv" });
    await press.call("POST", "/task-export", {
      workspaceId,
      format: "xlsx",
      projectIds: [web.id],
    });
  }

  // API keys with different scopes; the read-only one has a few requests.
  const keys = asList(await press.get("/api-key"), "keys");
  for (const spec of API_KEYS) {
    if (keys.some((k) => k.name === spec.name)) continue;
    const { projects: scoped, ...body } = spec;
    const created = await press.call("POST", "/api-key", {
      ...body,
      ...(scoped ? { projectIds: scoped.map((k) => bySlug(k).id) } : {}),
    });
    if (spec.access === "read" && created.key) {
      for (const path of [
        `/project?workspaceId=${workspaceId}`,
        `/task/tasks/${web.id}?limit=50&page=1`,
        `/analytics/workspace/${workspaceId}`,
      ]) {
        await fetch(new URL(`/api${path}`, API_URL), {
          headers: { "x-api-key": created.key },
        }).catch(() => {});
      }
    }
  }

  return {
    workspaceId,
    webId: web.id,
    archivedProjectId: archivedProject.id,
    webhookIds,
  };
}

/** The owner account's throwaway project for the CSV result shot. */
async function ensureSandbox() {
  const cookies = new Map();
  const call = async (method, path, body) => {
    const response = await fetch(new URL(`/api${path}`, API_URL), {
      method,
      headers: {
        Origin: CLIENT_URL,
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(cookies.size
          ? { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") }
          : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const at = pair.indexOf("=");
      cookies.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
    }
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${method} ${path} -> ${response.status}: ${text}`);
    }
    return text ? JSON.parse(text) : null;
  };
  await call("POST", "/auth/sign-in/email", OWNER);
  const session = await call("GET", "/auth/get-session");
  const workspaceId =
    session?.session?.activeOrganizationId ??
    (await call("GET", "/auth/organization/list"))[0]?.id;
  const projects = await call("GET", `/project?workspaceId=${workspaceId}`);
  const sandbox =
    projects.find((p) => p.slug === SANDBOX.slug) ??
    (await call("POST", "/project", {
      name: SANDBOX.name,
      workspaceId,
      icon: "Upload",
      slug: SANDBOX.slug,
    }));
  return { id: sandbox.id };
}

export const demo = await ensureDataDemo();
const sandbox = await ensureSandbox();

// ---------------------------------------------------------------------------
// Sample import files (fictional Studio North work).

const csv = (rows) =>
  `${rows
    .map((row) =>
      row
        .map((cell) =>
          /[",\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell,
        )
        .join(","),
    )
    .join("\n")}\n`;

const CSV_SAMPLE = csv([
  ["Title", "Description", "Status", "Priority", "Assignee", "Labels", "Due"],
  [
    "Write the launch blog post",
    "Draft, review with Priya, publish on launch day.",
    "To Do",
    "high",
    "priya.raman@margaya.test",
    "Docs",
    "2026-11-03",
  ],
  [
    "Compress hero images",
    "",
    "In Progress",
    "medium",
    "jonas.weber@margaya.test",
    "Frontend",
    "2026-10-29",
  ],
  [
    "Add pricing FAQ schema markup",
    "",
    "Ready for QA",
    "low",
    "theo.okafor@margaya.test",
    "Frontend, SEO",
    "",
  ],
  [
    "Set up redirect map for old blog URLs",
    "",
    "Backlog",
    "medium",
    "Marta Klein",
    "Backend",
    "2026-11-10",
  ],
  [
    "Record the product walkthrough video",
    "",
    "To Do",
    "high",
    "sofia.duarte@margaya.test",
    "Design",
    "2026-11-05",
  ],
  ["", "Row without a title", "", "", "", "", ""],
]);

const JIRA_SAMPLE = csv([
  [
    "Summary",
    "Issue key",
    "Issue id",
    "Issue Type",
    "Status",
    "Status Category",
    "Priority",
    "Assignee",
    "Reporter",
    "Created",
    "Updated",
    "Due date",
    "Labels",
    "Sprint",
    "Component/s",
    "Parent id",
    "Outward issue link (Blocks)",
    "Comment",
    "Description",
  ],
  [
    "Checkout fails on Safari 17",
    "SN-101",
    "10101",
    "Bug",
    "In Progress",
    "In Progress",
    "Highest",
    "Jonas Weber",
    "Priya Raman",
    "02/Oct/26 9:15 AM",
    "14/Oct/26 4:40 PM",
    "24/Oct/26",
    "checkout",
    "Sprint 21",
    "Web",
    "",
    "SN-104",
    "03/Oct/26 10:02 AM;Priya Raman;Reproduced on two Macs.",
    "h3. Steps\n# Add a plan to the cart\n# Pay with Apple Pay",
  ],
  [
    "Pricing page A/B test",
    "SN-102",
    "10102",
    "Story",
    "Selected for Development",
    "To Do",
    "Medium",
    "Sofia Duarte",
    "Elena Marsh",
    "05/Oct/26 11:20 AM",
    "12/Oct/26 2:10 PM",
    "",
    "growth",
    "Sprint 21",
    "Web",
    "",
    "",
    "",
    "Test the annual toggle against the current layout.",
  ],
  [
    "Write the test plan",
    "SN-103",
    "10103",
    "Sub-task",
    "Done",
    "Done",
    "Low",
    "Sofia Duarte",
    "Sofia Duarte",
    "06/Oct/26 9:00 AM",
    "09/Oct/26 3:30 PM",
    "",
    "",
    "Sprint 21",
    "",
    "10102",
    "",
    "",
    "",
  ],
  [
    "Update payment provider SDK",
    "SN-104",
    "10104",
    "Task",
    "Code Review",
    "In Progress",
    "High",
    "Marta Klein",
    "Jonas Weber",
    "07/Oct/26 1:45 PM",
    "15/Oct/26 10:05 AM",
    "",
    "payments",
    "Sprint 22",
    "API",
    "",
    "",
    "",
    "",
  ],
  [
    "Customer stories carousel",
    "SN-105",
    "10105",
    "Story",
    "Backlog",
    "To Do",
    "Medium",
    "",
    "Elena Marsh",
    "08/Oct/26 4:00 PM",
    "08/Oct/26 4:00 PM",
    "",
    "content",
    "",
    "Web",
    "",
    "",
    "",
    "",
  ],
]);

const TRELLO_SAMPLE = JSON.stringify({
  id: "64f1a2b3c4d5e6f708091a2b",
  name: "Studio North content",
  lists: [
    { id: "l1", name: "Ideas", closed: false, pos: 1 },
    { id: "l2", name: "Writing", closed: false, pos: 2 },
    { id: "l3", name: "Ready to publish", closed: false, pos: 3 },
    { id: "l4", name: "Published", closed: false, pos: 4 },
  ],
  labels: [
    { id: "b1", name: "Blog", color: "blue" },
    { id: "b2", name: "", color: "green" },
  ],
  members: [
    { id: "m1", fullName: "Priya Raman", username: "priya" },
    { id: "m2", fullName: "Sofia Duarte", username: "sofia" },
    { id: "m3", fullName: "Lena Fischer", username: "lena" },
  ],
  cards: [
    ["c1", "How we plan a website relaunch", "l2", ["m1"], ["b1"]],
    ["c2", "Customer story: Northwind", "l1", ["m3"], ["b1", "b2"]],
    ["c3", "Release notes for October", "l3", ["m2"], []],
    ["c4", "Five tips for faster boards", "l4", ["m1"], ["b1"]],
    ["c5", "Behind the scenes: our design system", "l1", [], ["b2"]],
  ].map(([id, name, idList, idMembers, idLabels], index) => ({
    id: `6501a2b3c4d5e6f70809${String(index).padStart(4, "0")}`,
    shortLink: `Sn${id}xQ7`,
    name,
    desc: "",
    idList,
    idMembers,
    idLabels,
    closed: false,
    due: index === 0 ? "2026-11-02T17:00:00.000Z" : null,
    start: null,
    dateLastActivity: "2026-10-14T09:30:00.000Z",
  })),
  checklists: [
    {
      id: "k1",
      idCard: "6501a2b3c4d5e6f708090000",
      name: "Outline",
      pos: 1,
      checkItems: [
        { name: "Intro", state: "complete", pos: 1 },
        { name: "Timeline", state: "incomplete", pos: 2 },
      ],
    },
  ],
  actions: [
    {
      id: "a1",
      type: "commentCard",
      date: "2026-10-12T10:00:00.000Z",
      data: {
        card: { id: "6501a2b3c4d5e6f708090000" },
        text: "Add the Sprint 14 numbers.",
      },
      memberCreator: { fullName: "Sofia Duarte" },
    },
  ],
});

const LINEAR_SAMPLE = csv([
  [
    "ID",
    "Title",
    "Description",
    "Status",
    "Priority",
    "Assignee",
    "Creator",
    "Labels",
    "Due Date",
    "Created",
    "Updated",
    "Parent issue",
    "Blocked by",
  ],
  [
    "ENG-41",
    "Rate limit the public search endpoint",
    "",
    "In Progress",
    "High",
    "jonas.weber@margaya.test",
    "priya.raman@margaya.test",
    "Backend",
    "2026-10-30",
    "2026-10-01T09:00:00.000Z",
    "2026-10-15T12:00:00.000Z",
    "",
    "",
  ],
  [
    "ENG-42",
    "Add request ids to API logs",
    "",
    "Todo",
    "Medium",
    "theo.okafor@margaya.test",
    "jonas.weber@margaya.test",
    "Backend",
    "",
    "2026-10-02T09:00:00.000Z",
    "2026-10-10T12:00:00.000Z",
    "ENG-41",
    "",
  ],
  [
    "ENG-43",
    "Document webhook signatures",
    "",
    "In Review",
    "Low",
    "priya.raman@margaya.test",
    "priya.raman@margaya.test",
    "Docs",
    "",
    "2026-10-03T09:00:00.000Z",
    "2026-10-12T12:00:00.000Z",
    "",
    "ENG-41",
  ],
  [
    "ENG-44",
    "Retire the v1 export endpoint",
    "",
    "Backlog",
    "No priority",
    "Ravi Patel",
    "theo.okafor@margaya.test",
    "",
    "",
    "2026-10-04T09:00:00.000Z",
    "2026-10-04T09:00:00.000Z",
    "",
    "",
  ],
  [
    "ENG-45",
    "Upgrade the database driver",
    "",
    "Done",
    "Medium",
    "jonas.weber@margaya.test",
    "jonas.weber@margaya.test",
    "Backend",
    "",
    "2026-09-20T09:00:00.000Z",
    "2026-10-08T12:00:00.000Z",
    "",
    "",
  ],
]);

const ASANA_SAMPLE = csv([
  [
    "Task ID",
    "Created At",
    "Completed At",
    "Last Modified",
    "Name",
    "Section/Column",
    "Assignee",
    "Assignee Email",
    "Start Date",
    "Due Date",
    "Tags",
    "Notes",
    "Parent task",
    "Blocked By (Dependencies)",
    "Priority",
  ],
  [
    "1205000000000001",
    "2026-10-01",
    "",
    "2026-10-14",
    "Plan the October newsletter",
    "Planning",
    "Sofia Duarte",
    "sofia.duarte@margaya.test",
    "",
    "2026-10-28",
    "Newsletter",
    "",
    "",
    "",
    "High",
  ],
  [
    "1205000000000002",
    "2026-10-02",
    "",
    "2026-10-13",
    "Pick the featured customer story",
    "Planning",
    "Priya Raman",
    "priya.raman@margaya.test",
    "",
    "",
    "",
    "",
    "1205000000000001",
    "",
    "Medium",
  ],
  [
    "1205000000000003",
    "2026-10-03",
    "",
    "2026-10-12",
    "Design the header image",
    "In design",
    "Lena Fischer",
    "",
    "2026-10-15",
    "2026-10-22",
    "Design",
    "",
    "",
    "1205000000000002",
    "Medium",
  ],
  [
    "1205000000000004",
    "2026-09-25",
    "2026-10-09",
    "2026-10-09",
    "Clean up the subscriber list",
    "In design",
    "Theo Okafor",
    "theo.okafor@margaya.test",
    "",
    "",
    "",
    "",
    "",
    "",
    "Low",
  ],
  [
    "1205000000000005",
    "2026-10-05",
    "",
    "2026-10-05",
    "Schedule the send",
    "",
    "",
    "",
    "",
    "2026-10-30",
    "",
    "",
    "",
    "",
    "",
  ],
]);

const file = (name, mimeType, content) => ({
  name,
  mimeType,
  buffer: Buffer.from(content, "utf8"),
});

// ---------------------------------------------------------------------------
// Helpers for prepare().

const DIALOG = "[role=dialog]";
const section = (title) => `section:has(h2:text-is("${title}"))`;

async function openImport(page) {
  await page.getByRole("button", { name: "Import tasks" }).click();
  await page.getByRole("dialog").waitFor();
}

async function pickFile(page, payload) {
  await page
    .locator(`${DIALOG} input[type=file]`)
    .last()
    .setInputFiles(payload);
}

async function next(page) {
  await page.getByRole("dialog").getByRole("button", { name: "Next" }).click();
}

/** Opens the CSV import with the sample file, on the Upload step. */
async function csvUpload(page) {
  await openImport(page);
  await pickFile(page, file("studio-north-tasks.csv", "text/csv", CSV_SAMPLE));
  await page.getByRole("dialog").getByText("Import from CSV").waitFor();
  await page.getByRole("dialog").getByText("6 rows").first().waitFor();
}

async function openSource(page, label, payload, readyText) {
  await openImport(page);
  await page.getByRole("dialog").getByRole("button", { name: label }).click();
  await page.waitForTimeout(400);
  await pickFile(page, payload);
  await page.getByRole("dialog").getByText(readyText).first().waitFor();
}

const settingsProject = (seed) =>
  `/dashboard/settings/projects/${seed.projects.web.id}/general`;
const ws = (seed) => `/dashboard/workspace/${seed.workspace.id}`;

const PAGE = "[data-slot=settings-page]";
const SHEET = "[role=dialog]";
const TALL = { width: 1440, height: 1400 };

async function reveal(page, selector) {
  await page.locator(selector).first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
}

const shot = (spec) => spec;

export default [
  // --- Imports --------------------------------------------------------
  shot({
    name: "data/import-export-row",
    url: settingsProject,
    ready: "Import and export",
    prepare: (page) => reveal(page, section("Import and export")),
    clip: { selector: section("Import and export"), pad: 12 },
  }),
  shot({
    name: "data/import-dialog",
    url: settingsProject,
    ready: "Import and export",
    prepare: openImport,
    clip: { selector: DIALOG, pad: 0 },
    viewport: TALL,
  }),
  shot({
    name: "data/csv-upload",
    url: settingsProject,
    ready: "Import and export",
    prepare: csvUpload,
    clip: { selector: DIALOG, pad: 0 },
    viewport: TALL,
  }),
  shot({
    name: "data/csv-map",
    url: settingsProject,
    ready: "Import and export",
    prepare: async (page) => {
      await csvUpload(page);
      await next(page);
      await page.getByRole("dialog").getByText("Margaya field").waitFor();
    },
    clip: { selector: DIALOG, pad: 0 },
    viewport: TALL,
  }),
  shot({
    name: "data/csv-review",
    url: settingsProject,
    ready: "Import and export",
    prepare: async (page) => {
      await csvUpload(page);
      await next(page);
      await next(page);
      await page.getByRole("dialog").getByText("will be imported").waitFor();
    },
    clip: { selector: DIALOG, pad: 0 },
    viewport: TALL,
  }),
  shot({
    // The only shot that really imports: into the owner's sandbox project.
    name: "data/csv-result",
    account: "owner",
    url: () => `/dashboard/settings/projects/${sandbox.id}/general`,
    ready: "Import and export",
    prepare: async (page) => {
      await csvUpload(page);
      await next(page);
      await next(page);
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Import", exact: true })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Done" })
        .waitFor({ timeout: 60_000 });
    },
    clip: { selector: DIALOG, pad: 0 },
    viewport: TALL,
  }),
  shot({
    name: "data/jira-upload",
    url: settingsProject,
    ready: "Import and export",
    prepare: (page) =>
      openSource(
        page,
        "Jira (CSV export)",
        file("studio-north-jira.csv", "text/csv", JIRA_SAMPLE),
        "5 issues",
      ),
    clip: { selector: DIALOG, pad: 0 },
    viewport: TALL,
  }),
  shot({
    name: "data/jira-map",
    url: settingsProject,
    ready: "Import and export",
    prepare: async (page) => {
      await openSource(
        page,
        "Jira (CSV export)",
        file("studio-north-jira.csv", "text/csv", JIRA_SAMPLE),
        "5 issues",
      );
      await next(page);
      await page.getByRole("dialog").getByText("Jira status").waitFor();
    },
    clip: { selector: DIALOG, pad: 0 },
    viewport: { width: 1440, height: 1800 },
  }),
  shot({
    name: "data/trello-upload",
    url: settingsProject,
    ready: "Import and export",
    prepare: (page) =>
      openSource(
        page,
        "Trello (JSON)",
        file("studio-north-content.json", "application/json", TRELLO_SAMPLE),
        "5 items",
      ),
    clip: { selector: DIALOG, pad: 0 },
    viewport: TALL,
  }),
  ...[
    [
      "trello",
      "Trello (JSON)",
      file("studio-north-content.json", "application/json", TRELLO_SAMPLE),
    ],
    [
      "linear",
      "Linear (CSV)",
      file("studio-north-linear.csv", "text/csv", LINEAR_SAMPLE),
    ],
    [
      "asana",
      "Asana (CSV)",
      file("studio-north-newsletter.csv", "text/csv", ASANA_SAMPLE),
    ],
  ].map(([source, label, payload]) =>
    shot({
      name: `data/${source}-map`,
      url: settingsProject,
      ready: "Import and export",
      prepare: async (page) => {
        await openSource(page, label, payload, "5 items");
        await next(page);
        await page.getByRole("dialog").getByText("Status or list").waitFor();
      },
      clip: { selector: DIALOG, pad: 0 },
      viewport: { width: 1440, height: 1800 },
    }),
  ),

  // --- Exports --------------------------------------------------------
  shot({
    name: "data/new-export-dialog",
    url: "/dashboard/settings/workspace/exports",
    ready: "Previous exports",
    prepare: async (page) => {
      await page.getByRole("button", { name: "New export" }).click();
      await page
        .getByRole("dialog")
        .getByText("One file per project")
        .waitFor();
    },
    clip: { selector: DIALOG, pad: 0 },
  }),
  shot({
    name: "data/previous-exports",
    url: "/dashboard/settings/workspace/exports",
    ready: "Previous exports",
    clip: { selector: PAGE, pad: 0 },
    viewport: { width: 1440, height: 520 },
  }),

  // --- Archives -------------------------------------------------------
  shot({
    name: "data/archives-tasks",
    url: (seed) => `${ws(seed)}/archives`,
    ready: "Retire the legacy pricing PDF",
    clip: { x: 312, y: 0, width: 1128, height: 310 },
  }),
  shot({
    name: "data/archives-projects",
    url: (seed) => `${ws(seed)}/archives?tab=projects`,
    ready: "Brand refresh 2024",
    clip: { x: 312, y: 0, width: 1128, height: 158 },
  }),
  shot({
    name: "data/archived-project-banner",
    url: (seed) => `${ws(seed)}/project/${demo.archivedProjectId}/board`,
    ready: "This project is archived.",
    clip: { x: 312, y: 0, width: 1128, height: 128 },
  }),

  // --- Trash ----------------------------------------------------------
  shot({
    name: "data/project-trash",
    url: (seed) => `/dashboard/settings/projects/${seed.projects.web.id}/trash`,
    ready: "Cookie banner copy",
    prepare: async (page) => {
      await page
        .getByRole("button", { name: "More actions for Old footer link audit" })
        .click();
      await page
        .getByRole("menuitem", { name: "Delete permanently" })
        .waitFor();
    },
    keepPointer: true,
    clip: { selector: PAGE, pad: 0 },
    viewport: { width: 1440, height: 460 },
  }),
  shot({
    name: "data/workspace-trash",
    url: "/dashboard/settings/workspace/trash",
    ready: "Spring campaign 2025",
    clip: { selector: PAGE, pad: 0 },
    viewport: { width: 1440, height: 320 },
  }),

  // --- Audit log ------------------------------------------------------
  shot({
    name: "data/audit-log",
    url: "/dashboard/settings/workspace/audit-log",
    ready: "Export CSV",
    clip: { x: 312, y: 48, width: 1128, height: 628 },
  }),
  shot({
    name: "data/audit-log-details",
    url: "/dashboard/settings/workspace/audit-log",
    ready: "Changed workspace settings",
    prepare: async (page) => {
      await page
        .locator("tr", { hasText: "Changed workspace settings" })
        .first()
        .getByRole("button", { name: "Show details" })
        .click();
      await page.getByText("IP address").first().waitFor();
    },
    clip: { x: 312, y: 48, width: 1128, height: 560 },
  }),

  // --- Webhooks -------------------------------------------------------
  shot({
    name: "data/webhooks-list",
    url: "/dashboard/settings/workspace/webhooks",
    ready: "Release notifier",
    clip: { selector: PAGE, pad: 0 },
    viewport: { width: 1440, height: 400 },
  }),
  shot({
    name: "data/webhook-create",
    url: "/dashboard/settings/workspace/webhooks",
    ready: "Release notifier",
    prepare: async (page) => {
      await page.getByRole("button", { name: "Create webhook" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Name").fill("Deploy notifier");
      await dialog
        .getByLabel("Endpoint URL")
        .fill("https://deploy.studionorth.example/margaya");
      await dialog.getByText("Choose events", { exact: true }).click();
      await dialog.getByText("Tasks", { exact: true }).first().waitFor();
      // Projects, Statuses, Tasks: tick the Tasks group.
      await dialog.getByRole("checkbox").nth(2).click();
    },
    clip: { selector: DIALOG, pad: 0 },
    viewport: TALL,
  }),
  shot({
    name: "data/webhook-deliveries",
    url: () =>
      `/dashboard/settings/workspace/webhooks/${demo.webhookIds["Release notifier"]}`,
    ready: "webhook.ping",
    clip: { selector: PAGE, pad: 0 },
    viewport: { width: 1440, height: 620 },
  }),
  shot({
    name: "data/webhook-delivery",
    url: () =>
      `/dashboard/settings/workspace/webhooks/${demo.webhookIds["Release notifier"]}`,
    ready: "webhook.ping",
    prepare: async (page) => {
      await page.getByText("webhook.ping").last().click();
      await page.getByRole("dialog").getByText("Request headers").waitFor();
    },
    clip: { selector: SHEET, pad: 0 },
  }),
  shot({
    name: "data/webhook-settings",
    url: () =>
      `/dashboard/settings/workspace/webhooks/${demo.webhookIds["Release notifier"]}?tab=settings`,
    ready: "Rotate secret",
    clip: { selector: PAGE, pad: 0 },
    // Ends below the signing secret card, before the danger zone.
    viewport: { width: 1440, height: 1285 },
  }),

  // --- Account --------------------------------------------------------
  shot({
    name: "account/information",
    url: "/dashboard/settings/account/information",
    ready: "Profile picture",
    clip: { selector: PAGE, pad: 0 },
    viewport: { width: 1440, height: 640 },
  }),
  shot({
    name: "account/delete-account",
    url: "/dashboard/settings/account/information",
    ready: "Profile picture",
    prepare: async (page) => {
      await page.getByRole("button", { name: "Delete account" }).click();
      await page
        .getByRole("alertdialog")
        .getByText("Delete your account?")
        .waitFor();
    },
    clip: { selector: "[role=alertdialog]", pad: 0 },
  }),
  shot({
    name: "account/password",
    url: "/dashboard/settings/account/security",
    ready: "Current password",
    clip: { selector: section("Password"), pad: 12 },
  }),
  shot({
    name: "account/two-factor-setup",
    url: "/dashboard/settings/account/security",
    ready: "Two-factor authentication",
    prepare: async (page) => {
      // Setting up stores a pending secret only: two-factor stays off until
      // a code is verified, so the demo account still signs in normally.
      const box = page.locator(section("Two-factor authentication"));
      await box.getByRole("button", { name: "Turn on" }).click();
      await box.locator("input[type=password]").fill(DEMO_PASSWORD);
      await box.getByRole("button", { name: "Continue" }).click();
      await box.getByText("Setup key").first().waitFor();
      await box.scrollIntoViewIfNeeded();
    },
    clip: { selector: section("Two-factor authentication"), pad: 12 },
    viewport: TALL,
  }),
  shot({
    name: "account/sessions",
    url: "/dashboard/settings/account/security",
    ready: "Active sessions",
    prepare: async (page) => {
      // Every capture run signs in again, so the demo account collects
      // dozens of sessions. Show this device and two others, as a person
      // with a laptop and a phone would see it.
      await page.evaluate(() => {
        const badge = [...document.querySelectorAll("section *")].find(
          (el) => el.children.length === 0 && el.textContent === "This device",
        );
        let row = badge;
        while (row?.parentElement && row.parentElement.children.length < 3) {
          row = row.parentElement;
        }
        if (!row?.parentElement) return;
        const others = [...row.parentElement.children].filter(
          (el) => el !== row && el.textContent.includes("Edge on"),
        );
        const keep = new Set([row, ...others.slice(0, 2)]);
        for (const el of row.parentElement.children) {
          if (!keep.has(el)) el.style.display = "none";
        }
      });
      await reveal(page, section("Active sessions"));
    },
    clip: { selector: section("Active sessions"), pad: 12 },
    viewport: TALL,
  }),
  shot({
    name: "account/api-keys",
    url: "/dashboard/settings/account/developer",
    ready: "Weekly report",
    clip: { selector: PAGE, pad: 0 },
    viewport: { width: 1440, height: 400 },
  }),
  shot({
    name: "account/api-key-create",
    url: "/dashboard/settings/account/developer",
    ready: "Weekly report",
    prepare: async (page) => {
      await page.getByRole("button", { name: "Create API key" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Name").fill("Deploy bot");
      await dialog.getByText("Custom", { exact: true }).click();
      await dialog.getByText("Areas", { exact: true }).waitFor();
    },
    clip: { selector: DIALOG, pad: 0 },
    viewport: { width: 1440, height: 1600 },
  }),
  shot({
    name: "account/api-key-requests",
    url: "/dashboard/settings/account/developer",
    ready: "Weekly report",
    prepare: async (page) => {
      await page
        .getByRole("button", { name: "Requests made with Weekly report" })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("columnheader", { name: "Duration" })
        .waitFor();
    },
    clip: { selector: SHEET, pad: 0 },
    // The sheet is as tall as the window; a short one avoids empty space.
    viewport: { width: 1440, height: 380 },
  }),
  shot({
    name: "account/notify-me-about",
    url: "/dashboard/settings/account/notifications",
    ready: "Notify me about",
    clip: { selector: section("Notify me about"), pad: 12 },
  }),
  shot({
    name: "account/delivery-channels",
    url: "/dashboard/settings/account/notifications",
    ready: "Delivery channels",
    prepare: (page) => reveal(page, section("Delivery channels")),
    clip: { selector: section("Delivery channels"), pad: 12 },
    viewport: { width: 1440, height: 2200 },
  }),
  shot({
    name: "account/email-digest",
    url: "/dashboard/settings/account/notifications",
    ready: "Notify me about",
    prepare: (page) => reveal(page, section("Email digest")),
    clip: { selector: section("Email digest"), pad: 12 },
    viewport: TALL,
  }),
  shot({
    name: "account/workspace-rules",
    url: "/dashboard/settings/account/notifications",
    ready: "Notify me about",
    prepare: (page) => reveal(page, section("Workspace delivery rules")),
    clip: { selector: section("Workspace delivery rules"), pad: 12 },
    viewport: TALL,
  }),
  shot({
    name: "account/preferences-appearance",
    url: "/dashboard/settings/account/preferences",
    ready: "Appearance",
    clip: { selector: section("Appearance"), pad: 12 },
  }),
  shot({
    name: "account/preferences-theme",
    url: "/dashboard/settings/account/preferences",
    ready: "Appearance",
    prepare: async (page) => {
      // Opens the list only; picking a theme would change the account.
      await page.getByRole("combobox", { name: "Theme" }).click();
      await page.getByRole("option", { name: "High contrast dark" }).waitFor();
    },
    clip: { selector: section("Appearance"), pad: 12 },
  }),
  shot({
    name: "account/customize-sidebar",
    url: "/dashboard/settings/account/preferences",
    ready: "Appearance",
    prepare: async (page) => {
      await page.getByRole("button", { name: "Customize sidebar" }).click();
      await page.getByRole("dialog").getByText("Projects panel").waitFor();
    },
    clip: { selector: DIALOG, pad: 0 },
    viewport: TALL,
  }),
  shot({
    name: "account/display-options",
    url: "/dashboard/settings/account/preferences",
    ready: "Appearance",
    prepare: (page) => reveal(page, section("Display options")),
    clip: { selector: section("Display options"), pad: 12 },
    viewport: TALL,
  }),
];
