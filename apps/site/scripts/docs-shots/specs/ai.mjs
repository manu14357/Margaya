/**
 * Screenshots for the AI, automation, forecast and insight docs
 * (apps/docs/core/functional and integrations/a2a).
 *
 * LOCAL DEVELOPMENT ONLY. Two kinds of data are involved:
 *
 * - Real records, created idempotently through the public API by
 *   ensureAiDemo(): a "Client support" project with automation rules and
 *   their runs.
 * - AI answers. A capture needs no AI provider: `before` hooks intercept the
 *   AI routes in the browser (page.route) and answer with scripted,
 *   feature-shaped responses that cite real Studio North tasks. The server's
 *   AI settings are never changed, so nothing here sends data anywhere.
 */

process.env.PRESS_API_URL ??= "http://127.0.0.1:1337";
process.env.PRESS_CLIENT_URL ??= "http://localhost:5173";
const { DEMO_USERS, DEMO_WORKSPACE, signIn } = await import(
  "../../press/seed-demo.mjs"
);

const SUPPORT = {
  name: "Client support",
  slug: "SUP",
  icon: "MessageSquare",
};

/** Tasks: [title, status, priority, assignee, label?]. */
const SUPPORT_TASKS = [
  [
    "Checkout button hidden on small phones",
    "in-progress",
    "high",
    "theo",
    "Bug",
  ],
  [
    "Invoice PDF shows the wrong VAT number",
    "in-progress",
    "medium",
    "jonas",
    "Bug",
  ],
  ["Password reset email arrives twice", "to-do", "medium", "jonas", "Bug"],
  ["Add a status page link to the help center", "to-do", "low", "sofia"],
  ["Answer the Q3 accessibility questionnaire", "to-do", "medium", "priya"],
];

/** Created later, so the "crash report" rule fires for them. */
const CRASH_TASKS = [
  ["Crash when exporting a report with 10,000 rows", "to-do", "medium", "theo"],
  ["Crash on sign-in with an expired invite link", "to-do", "medium", "jonas"],
];

const GERMAN_COMMENT =
  "Die Übersetzung der Startseite ist fertig. Bitte prüft noch die Preise in Euro und den Text im Kontaktformular, bevor wir live gehen.";

function day(offset) {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString();
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

async function ensureAiDemo() {
  // Only the owner signs in (sign-ins are rate limited); the others are
  // looked up as members.
  const press = await signIn(DEMO_USERS.press);
  const workspace = (await press.get("/auth/organization/list")).find(
    (w) => w.name === DEMO_WORKSPACE.name,
  );
  if (!workspace) throw new Error("Run scripts/press/seed-demo.mjs first");
  const workspaceId = workspace.id;
  await press.call("POST", "/auth/organization/set-active", {
    organizationId: workspaceId,
  });
  const listed = await press.get("/auth/organization/list-members", {
    organizationId: workspaceId,
  });
  const members = Array.isArray(listed) ? listed : (listed.members ?? []);
  const s = {};
  for (const [key, user] of Object.entries(DEMO_USERS)) {
    const member = members.find((m) => m.user?.email === user.email);
    if (!member)
      throw new Error(`${user.email} is not in ${DEMO_WORKSPACE.name}`);
    s[key] = { id: member.userId };
  }
  const projects = await press.get("/project", {
    workspaceId,
    includeArchived: "true",
  });
  const labels = await press.get(`/label/workspace/${workspaceId}`);
  const labelId = (name) =>
    labels.find((l) => l.taskId === null && l.name === name)?.id;

  let support = projects.find((p) => p.slug === SUPPORT.slug);
  if (!support) {
    support = await press.call("POST", "/project", {
      name: SUPPORT.name,
      workspaceId,
      icon: SUPPORT.icon,
      slug: SUPPORT.slug,
    });
  }
  if (!support.cyclesEnabled) {
    support = await press.call("PATCH", `/project/${support.id}/features`, {
      cyclesEnabled: true,
    });
  }
  const columns = await press.get(`/column/${support.id}`);
  const column = (name) => columns.find((c) => c.name === name)?.id;

  const createTasks = async (specs, existing) => {
    const out = {};
    for (const [title, status, priority, who, label] of specs) {
      let task = existing.find((t) => t.title === title);
      if (!task) {
        task = await press.call("POST", `/task/${support.id}`, {
          title,
          description: "",
          priority,
          status,
          assigneeIds: [s[who].id],
        });
        if (label) {
          await press.call("PUT", `/label/${labelId(label)}/task`, {
            taskId: task.id,
          });
        }
      }
      out[title] = task;
    }
    return out;
  };

  let tasks = await createTasks(
    SUPPORT_TASKS,
    await listTasks(press, support.id),
  );

  // An ended cycle, so one rule's "move to cycle" action fails on purpose.
  const cycles = await press.get(`/cycle/project/${support.id}`);
  const cycleList = Array.isArray(cycles) ? cycles : (cycles.cycles ?? []);
  let ended = cycleList.find((c) => c.name === "Support sprint 3");
  ended ??= await press.call("POST", `/cycle/project/${support.id}`, {
    name: "Support sprint 3",
    startDate: day(-24).slice(0, 10),
    endDate: day(-11).slice(0, 10),
  });

  const rules = await press.get(`/automation-rule/${support.id}`);
  const ruleList = Array.isArray(rules) ? rules : (rules.rules ?? []);
  const RULES = [
    {
      name: "Send bugs in review to QA",
      trigger: { type: "status_changed", to: [column("In Review")] },
      conditions: {
        op: "and",
        conditions: [{ field: "labels", op: "contains", labels: ["Bug"] }],
      },
      actions: [
        { type: "assign", userIds: [s.priya.id] },
        { type: "add_label", label: "needs-qa" },
      ],
    },
    {
      name: "Triage new crash reports",
      trigger: { type: "task_created" },
      conditions: {
        op: "and",
        conditions: [{ field: "title", op: "contains", value: "crash" }],
      },
      actions: [
        { type: "set_priority", priority: "high" },
        { type: "add_label", label: "Bug" },
      ],
    },
    {
      name: "Pull urgent work into the sprint",
      trigger: { type: "priority_changed", to: ["urgent"] },
      conditions: null,
      actions: [
        {
          type: "add_comment",
          template: "{{task.key}} is urgent, so it moves into the sprint.",
        },
        { type: "move_to_cycle", cycleId: ended.id },
      ],
    },
    {
      name: "Escalate overdue tasks",
      enabled: false,
      trigger: { type: "due_date_passed" },
      conditions: null,
      actions: [
        { type: "set_priority", priority: "urgent" },
        {
          type: "notify",
          roles: ["assignees"],
          message: "{{task.key}} is overdue.",
        },
      ],
    },
  ];
  let fresh = false;
  for (const rule of RULES) {
    if (ruleList.some((r) => r.name === rule.name)) continue;
    await press.call("POST", `/automation-rule/${support.id}`, rule);
    fresh = true;
  }

  if (fresh) {
    // Fire the rules once, so the list and the run history have runs.
    for (const title of [
      "Checkout button hidden on small phones",
      "Invoice PDF shows the wrong VAT number",
    ]) {
      await press.call("PUT", `/task/status/${tasks[title].id}`, {
        status: "in-review",
      });
    }
    tasks = {
      ...tasks,
      ...(await createTasks(CRASH_TASKS, await listTasks(press, support.id))),
    };
    await press.call(
      "PUT",
      `/task/priority/${tasks["Password reset email arrives twice"].id}`,
      { priority: "urgent" },
    );
  }

  // Comment ids, for Ask's comment citations ([C:WEB-1/abc123]).
  const commentId = async (taskId, needle) => {
    const listed = await press.get(`/comment/${taskId}`);
    const list = Array.isArray(listed) ? listed : (listed?.comments ?? []);
    return list.find((c) => String(c.content ?? "").includes(needle))?.id;
  };
  const users = Object.fromEntries(
    Object.entries(s).map(([key, member]) => [
      key,
      { id: member.id, name: DEMO_USERS[key].name },
    ]),
  );

  // A comment in German, so "Translate" has something to translate.
  const webTasks = await listTasks(
    press,
    projects.find((p) => p.slug === "WEB").id,
  );
  const german = webTasks.find(
    (t) => t.title === "Localize the landing page for German",
  );
  if (!(await commentId(german.id, GERMAN_COMMENT.slice(0, 30)))) {
    const jonas = await signIn(DEMO_USERS.jonas);
    await jonas.call("POST", "/auth/organization/set-active", {
      organizationId: workspaceId,
    });
    await jonas.call("POST", `/comment/${german.id}`, {
      content: GERMAN_COMMENT,
    });
  }

  return {
    workspaceId,
    users,
    labels: Object.fromEntries(
      labels.filter((l) => l.taskId === null).map((l) => [l.name, l.id]),
    ),
    support: {
      id: support.id,
      slug: support.slug,
      inReview: column("In Review"),
    },
    comments: {
      pricing: await commentId(
        (
          await listTasks(press, projects.find((p) => p.slug === "WEB").id)
        ).find((t) => t.title === "Redesign the pricing page").id,
        "enterprise column",
      ),
    },
  };
}

export const demo = await ensureAiDemo();

/* ------------------------------------------------------------------------ */
/* Browser-side AI answers                                                   */
/* ------------------------------------------------------------------------ */

const API_PREFIX = "/api";

/** Answers one API route (exact path or RegExp) in the browser. */
async function mock(page, method, path, respond) {
  await page.route(
    (url) =>
      url.pathname.startsWith(API_PREFIX) &&
      (path instanceof RegExp
        ? path.test(url.pathname.slice(API_PREFIX.length))
        : url.pathname.slice(API_PREFIX.length) === path),
    async (route) => {
      if (route.request().method() !== method) return route.fallback();
      const result =
        typeof respond === "function" ? await respond(route) : respond;
      if (result === undefined) return;
      if (typeof result === "string") {
        return route.fulfill({
          status: 200,
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-store",
          },
          body: result,
        });
      }
      return route.fulfill({ status: 200, json: result });
    },
  );
}

/** A Server-Sent Events body, as the AI streaming routes send it. */
function sse(meta, text, done = {}) {
  const event = (name, data) =>
    `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
  return [
    event("meta", { model: "claude-sonnet-5-5", ...meta }),
    // Several deltas, as a real stream would send them.
    ...(text.match(/[\s\S]{1,48}/g) ?? []).map((part) =>
      event("delta", { text: part }),
    ),
    event("done", {
      stop: "end_turn",
      usage: { input: 2400, output: 260, cacheRead: 1800, cacheWrite: 0 },
      costMicros: 11_000,
      model: "claude-sonnet-5-5",
      ...done,
    }),
  ].join("");
}

/** Turns AI on for the signed-in person, whatever the server says. */
async function aiOn(page, extra = {}) {
  await mock(page, "GET", "/ai/availability", {
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
    ...extra,
  });
}

/** Changes a real response before the app sees it. */
async function patchJson(page, path, edit) {
  await mock(page, "GET", path, async (route) => {
    const response = await route.fetch();
    return edit(await response.json(), route);
  });
}

/* ------------------------------------------------------------------------ */
/* Helpers                                                                   */
/* ------------------------------------------------------------------------ */

const ws = (seed) => `/dashboard/workspace/${seed.workspace.id}`;
const project = (seed, projectId) => `${ws(seed)}/project/${projectId}`;
const web = (seed) => project(seed, seed.projects.web.id);
const taskUrl = (seed, projectId, taskId) =>
  `${project(seed, projectId)}/task/${taskId}`;
const projectSettings = (projectId, tab) =>
  `/dashboard/settings/projects/${projectId}/${tab}`;

const TALL = { width: 1440, height: 1800 };
const VERY_TALL = { width: 1440, height: 2600 };

/** A settings section, found by its heading. */
const section = (title, pad = 16) => ({
  selector: `xpath=//h2[normalize-space()="${title}"]/ancestor::section[1]`,
  pad,
});

/** Sets `shot.clip` to the union of the locators' boxes. */
async function clipAround(shot, locators, pad = 12) {
  const boxes = [];
  for (const locator of locators) {
    const box = await locator.first().boundingBox();
    if (box) boxes.push(box);
  }
  if (boxes.length === 0) throw new Error(`${shot.name}: nothing to clip`);
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

/** The nearest ancestor of the element showing `text` that holds `button`. */
const cardOf = (page, text, button) =>
  page
    .locator(
      `xpath=//*[normalize-space()="${text}"]/ancestor::*[.//button[normalize-space()="${button}"]][1]`,
    )
    .first();

const days = (offset) => {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};
const ago = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();

/* ------------------------------------------------------------------------ */
/* Shots                                                                     */
/* ------------------------------------------------------------------------ */

const automationRules = {
  name: "tasks/automation-rules",
  url: () => projectSettings(demo.support.id, "workflow"),
  ready: "Send bugs in review to QA",
  viewport: VERY_TALL,
  async prepare(page) {
    const automations = page.locator(section("Automations").selector);
    await clipAround(
      this,
      [
        automations.getByRole("heading", { name: "Automations" }),
        automations.getByRole("button", { name: "Run history" }),
      ],
      16,
    );
  },
};

const automationEditor = {
  name: "tasks/automation-rule-editor",
  url: () => projectSettings(demo.support.id, "workflow"),
  ready: "Send bugs in review to QA",
  viewport: VERY_TALL,
  async prepare(page) {
    await page
      .getByRole("button", { name: "Edit Send bugs in review to QA" })
      .click();
    const save = page.getByRole("button", { name: "Save rule" });
    await save.waitFor();
    const editor = page
      .locator("div")
      .filter({ has: save })
      .filter({ hasText: "WHEN" })
      .last();
    await clipAround(this, [editor], 12);
  },
};

const automationRuns = {
  name: "tasks/automation-run-history",
  url: () => projectSettings(demo.support.id, "workflow"),
  ready: "Send bugs in review to QA",
  viewport: VERY_TALL,
  async prepare(page) {
    const runs = page.getByRole("button", { name: "Run history" });
    await runs.click();
    const last = page.getByText("Partly done").first();
    await last.waitFor();
    const list = page
      .locator("div, ul")
      .filter({ hasText: "Partly done" })
      .filter({ hasText: "Checkout button hidden on small phones" })
      .last();
    await clipAround(this, [runs, list], 12);
  },
};

const ruleCompiler = {
  name: "ai/rule-from-description",
  url: () => projectSettings(demo.support.id, "workflow"),
  ready: "Send bugs in review to QA",
  viewport: VERY_TALL,
  before: async (page) => {
    await aiOn(page);
    await mock(page, "POST", "/ai/rules/compile", {
      projectId: demo.support.id,
      status: "partial",
      rejected: 0,
      rules: [
        {
          engine: "automation_rule",
          rule: {
            name: "Hand bugs in review to Priya",
            trigger: { type: "status_changed", to: [demo.support.inReview] },
            conditions: {
              op: "and",
              conditions: [
                { field: "labels", op: "contains", labels: ["Bug"] },
              ],
            },
            actions: [
              { type: "assign", userIds: [demo.users.priya.id] },
              { type: "add_label", label: "needs-qa" },
            ],
          },
        },
      ],
      unsupported: [
        {
          request: "Text the client",
          reason:
            "Automations can notify people in this workspace, but they can't send text messages outside Margaya.",
        },
      ],
    });
  },
  async prepare(page) {
    await page
      .getByPlaceholder(/For example: when a GitHub pull request/)
      .fill(
        "When a bug moves to In review, assign Priya, add the needs-qa label and text the client",
      );
    await page.getByRole("button", { name: "Create rule" }).click();
    await page.getByRole("button", { name: "Try on history" }).click();
    await page.getByText(/Tasks that would have changed/).waitFor();
    await page.waitForTimeout(500);
    this.clip = section("Rule from a description");
  },
};

const a2aToggle = {
  name: "integrations/a2a-toggle",
  url: "/dashboard/settings/workspace/general",
  ready: "Agent-to-agent (A2A)",
  async prepare(page) {
    // The nearest ancestor that also holds the row's switch.
    const row = (text) =>
      page.locator(
        `xpath=//*[normalize-space()="${text}"]/ancestor::*[.//*[@role="switch"]][1]`,
      );
    await clipAround(
      this,
      [row("Public pages"), row("Agent-to-agent (A2A)")],
      0,
    );
  },
};

/* --- Demo task references --------------------------------------------- */

const TITLES = {
  web: {
    pricing: "Redesign the pricing page",
    video: "Fix hero video autoplay on Safari",
    stories: "Build the customer stories section",
    images: "Lazy-load images below the fold",
    a11y: "Accessibility audit for the navigation",
    newsletter: "Newsletter sign-up flow",
    perf: "Add a performance budget to CI",
    hero: "Ship the new homepage hero",
    footer: "Redesign the footer sitemap",
    analytics: "Set up cookie-less analytics",
    social: "Refresh the social share cards",
    german: "Localize the landing page for German",
    legal: "Update the legal pages",
  },
  mobile: {
    offline: "Offline mode for task lists",
    push: "Push notification preferences",
    rotate: "Crash when rotating the task sheet",
    biometric: "Biometric sign-in",
  },
  api: {
    ratelimit: "Rate limiting per API key",
    webhooks: "Webhook retries with backoff",
    reference: "Public API v2 reference docs",
  },
};

/** { id, key, title, projectId, url } of a seeded task. */
function ref(seed, projectKey, taskKey) {
  const project = seed.projects[projectKey];
  const task = project.tasks[taskKey];
  return {
    id: task.id,
    key: `${project.slug}-${task.number}`,
    title: TITLES[projectKey][taskKey],
    projectId: project.id,
    url: taskUrl(seed, project.id, task.id),
  };
}

const sprint14 = (seed) => seed.projects.web.cycles["Sprint 14"].id;
const cycleUrl = (seed) => `${web(seed)}/cycles/${sprint14(seed)}`;

/** "Oct 30" for a YYYY-MM-DD day. */
const shortDay = (day) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
const addDays = (day, offset) => {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};
const daysBetween = (from, to) =>
  Math.round(
    (new Date(`${to}T12:00:00Z`) - new Date(`${from}T12:00:00Z`)) / 86_400_000,
  );

/* --- AI setup ------------------------------------------------------------ */

const WORKSPACE_AI = (seed) => ({
  instance: {
    enabled: true,
    configured: true,
    provider: "anthropic",
    localAvailable: true,
    localOnly: false,
    allowWorkspaceKeys: true,
    restrictedRoute: "local",
    privateRoute: "cloud",
    redaction: false,
    zeroRetention: false,
  },
  workspace: {
    enabled: true,
    provider: null,
    hasKey: false,
    keyLast4: null,
    keyUnreadable: false,
    monthlyCapMicros: 50_000_000,
    userDailyCapTokens: 200_000,
    requireApprovalForWrites: false,
    includeRestricted: false,
    localOnly: false,
    redactPii: true,
    autoTranslateComments: false,
    embeddingsEnabled: false,
    updatedAt: ago(60 * 26),
    updatedBy: { id: seed.user.id, name: seed.user.name },
  },
  semantic: {
    vectorStore: "unavailable",
    endpointConfigured: false,
    indexedItems: 0,
    paused: null,
  },
  monthSpendMicros: 6_420_000,
});

function usageReport(seed) {
  const features = [
    ["ask", 182, 1_920_000],
    ["summarize", 64, 1_310_000],
    ["editor_assist", 141, 690_000],
    ["triage", 77, 820_000],
    ["brief", 21, 540_000],
    ["agent_run", 38, 960_000],
    ["translate", 46, 180_000],
  ];
  const totals = (calls, cost) => ({
    calls,
    inputTokens: calls * 2_600,
    outputTokens: calls * 310,
    costMicros: cost,
  });
  const byFeature = features.map(([feature, calls, cost]) => ({
    feature,
    ...totals(calls, cost),
  }));
  const sum = byFeature.reduce(
    (all, row) => ({
      calls: all.calls + row.calls,
      inputTokens: all.inputTokens + row.inputTokens,
      outputTokens: all.outputTokens + row.outputTokens,
      costMicros: all.costMicros + row.costMicros,
    }),
    { calls: 0, inputTokens: 0, outputTokens: 0, costMicros: 0 },
  );
  const people = [
    [seed.user.id, "Elena Marsh", 0.34],
    [demo.users.priya.id, "Priya Raman", 0.27],
    [demo.users.jonas.id, "Jonas Weber", 0.18],
    [demo.users.sofia.id, "Sofia Duarte", 0.12],
    [demo.users.theo.id, "Theo Okafor", 0.09],
  ];
  const share = (value, part) => Math.round(value * part);
  const today = days(0);
  const byDay = Array.from({ length: 22 }, (_, i) => {
    const calls = 12 + ((i * 7) % 17) + (i % 6 === 5 ? -8 : 0);
    return { day: addDays(today, i - 21), ...totals(calls, calls * 11_000) };
  });
  return {
    from: `${addDays(today, -21)}T00:00:00.000Z`,
    to: new Date().toISOString(),
    totals: sum,
    byFeature,
    byModel: [
      {
        provider: "anthropic",
        model: "claude-sonnet-5-5",
        ...totals(Math.round(sum.calls * 0.62), share(sum.costMicros, 0.78)),
      },
      {
        provider: "anthropic",
        model: "claude-haiku-5-5",
        ...totals(Math.round(sum.calls * 0.33), share(sum.costMicros, 0.12)),
      },
      {
        provider: "anthropic",
        model: "claude-opus-5-5",
        ...totals(Math.round(sum.calls * 0.05), share(sum.costMicros, 0.1)),
      },
    ],
    byUser: people.map(([userId, name, part]) => ({
      userId,
      name,
      ...totals(Math.round(sum.calls * part), share(sum.costMicros, part)),
    })),
    byDay,
  };
}

const aiSettingsBefore = async (page, seed) => {
  await aiOn(page);
  await mock(page, "GET", "/ai/settings", WORKSPACE_AI(seed));
  await mock(page, "GET", "/ai/usage", usageReport(seed));
};

const workspaceAi = {
  name: "ai/workspace-settings",
  url: "/dashboard/settings/workspace/ai",
  ready: "AI in this workspace",
  viewport: VERY_TALL,
  before: aiSettingsBefore,
  async prepare(page) {
    await clipAround(
      this,
      [
        page.getByText("AI in this workspace", { exact: true }),
        page.getByRole("button", { name: "Save limits" }),
      ],
      24,
    );
  },
};

const workspaceUsage = {
  name: "ai/usage",
  url: "/dashboard/settings/workspace/ai",
  ready: "AI in this workspace",
  viewport: VERY_TALL,
  before: aiSettingsBefore,
  async prepare(page) {
    await page.getByText("By person", { exact: true }).first().waitFor();
    const usage = page
      .locator(
        'xpath=//*[self::h2 or self::h3][normalize-space()="Usage"]/ancestor::section[1]',
      )
      .first();
    await clipAround(this, [usage], 16);
  },
};

const INSTANCE_AI = {
  "ai.enabled": true,
  "ai.provider": "anthropic",
  "ai.anthropic.apiKey": { configured: true },
  "ai.local.baseUrl": "http://ollama:11434/v1",
  "ai.local.model": "llama3.3",
  "ai.localOnly": false,
  "ai.embeddings.baseUrl": "",
  "ai.embeddings.model": "",
};

const instanceAi = {
  name: "ai/instance-provider",
  account: "owner",
  url: "/dashboard/settings/instance/ai",
  ready: "AI on this server",
  viewport: VERY_TALL,
  before: async (page) => {
    // Show a typical setup, never the server's own provider settings.
    await patchJson(page, "/instance-admin/settings", (body) => ({
      ...body,
      settings: body.settings.map((setting) => {
        if (!(setting.key in INSTANCE_AI)) return setting;
        const value = INSTANCE_AI[setting.key];
        return typeof value === "object"
          ? { ...setting, ...value, source: "database" }
          : { ...setting, value, source: "database" };
      }),
    }));
    await mock(page, "GET", "/ai/instance/status", {
      enabled: true,
      configured: true,
      fakeAllowed: false,
      provider: "anthropic",
      models: {
        fast: "claude-haiku-5-5",
        balanced: "claude-sonnet-5-5",
        deep: "claude-opus-5-5",
      },
      localAvailable: true,
      embeddingsConfigured: false,
      vectorStore: "unavailable",
    });
  },
  async prepare(page) {
    await page.getByText("Local model", { exact: true }).first().waitFor();
    await clipAround(
      this,
      [
        page.getByText("Provider", { exact: true }).first(),
        page.getByRole("switch", { name: "Local-only mode" }),
        page.getByRole("button", { name: "Test local model" }),
        page.getByText(/^Every AI call goes to the local model/),
      ],
      24,
    );
  },
};

/* --- Ask ---------------------------------------------------------------- */

const askAnswer = {
  name: "ai/ask-answer",
  url: (seed) => `${web(seed)}/board`,
  ready: "Annual billing toggle",
  before: async (page, seed) => {
    await aiOn(page);
    const pricing = ref(seed, "web", "pricing");
    const newsletter = ref(seed, "web", "newsletter");
    const video = ref(seed, "web", "video");
    const comment = `C:${pricing.key}/${demo.comments.pricing.slice(0, 6)}`;
    const source = (
      task,
      kind = "task",
      token = `T:${task.key}`,
      id = task.id,
    ) => ({
      ref: token,
      kind,
      id,
      title: `${task.key} ${task.title}`,
      url: task.url,
      projectId: task.projectId,
      updatedAt: ago(60 * 20),
    });
    const sources = [
      source(pricing),
      source(newsletter),
      source(pricing, "comment", comment, demo.comments.pricing),
      source(video),
      source(ref(seed, "web", "stories")),
    ];
    const text = `One dependency holds Sprint 14 up: **Redesign the pricing page** [T:${pricing.key}] is still in progress and blocks **Newsletter sign-up flow** [T:${newsletter.key}], so the newsletter work can't start yet.\n\nTo unblock it, Priya asked for a review of the enterprise column copy before Thursday [${comment}]. The Safari autoplay fix is waiting for review too [T:${video.key}], but nothing depends on it.`;
    await mock(
      page,
      "POST",
      "/ai/ask",
      sse({ sources, asOf: new Date().toISOString() }, text, {
        citations: [
          `T:${pricing.key}`,
          `T:${newsletter.key}`,
          comment,
          `T:${video.key}`,
        ],
        noResults: false,
      }),
    );
  },
  async prepare(page) {
    await page.getByRole("button", { name: "Ask AI" }).first().click();
    const box = page.getByPlaceholder("Ask about tasks, pages and comments…");
    await box.fill("What's blocking Sprint 14?");
    await box.press("Enter");
    const sources = page.getByText(/^Sources \(\d+\)$/).first();
    await sources.waitFor();
    await sources.click();
    const panel = await page.getByRole("dialog").boundingBox();
    const last = await page
      .getByText("Closest matches")
      .locator("xpath=..")
      .boundingBox();
    this.clip = {
      x: Math.floor(panel.x),
      y: Math.floor(panel.y),
      width: Math.ceil(panel.width),
      height: Math.ceil(last.y + last.height - panel.y + 24),
    };
  },
};

/* --- Writing ------------------------------------------------------------ */

const pageUrl = (seed) => `${web(seed)}/pages/${seed.projects.web.page.id}`;
const callout = (page) =>
  page.locator(".ProseMirror p").filter({ hasText: "Scope is frozen" }).first();

async function selectCallout(page) {
  await callout(page).waitFor();
  await callout(page).click({ clickCount: 3 });
  await page.getByRole("button", { name: "AI actions" }).click();
}

const writingBefore = async (page) => {
  await aiOn(page);
  await mock(
    page,
    "POST",
    "/ai/writing/assist",
    sse(
      { model: "claude-haiku-5-5" },
      "Sprint 14 scope is frozen. Add new requests to the backlog; we triage them every Monday.",
    ),
  );
};

const editorMenu = {
  name: "ai/editor-ai-menu",
  url: pageUrl,
  ready: "Scope is frozen",
  before: writingBefore,
  async prepare(page) {
    await selectCallout(page);
    const menu = page.getByRole("menu");
    await menu.waitFor();
    await clipAround(
      this,
      [page.getByRole("button", { name: "AI actions" }), menu],
      12,
    );
  },
  keepPointer: true,
};

const editorPreview = {
  name: "ai/editor-ai-preview",
  url: pageUrl,
  ready: "Scope is frozen",
  before: writingBefore,
  async prepare(page) {
    await selectCallout(page);
    await page.getByRole("menuitem", { name: "Improve writing" }).click();
    const replace = page.getByRole("button", { name: "Replace" });
    await replace.waitFor();
    await clipAround(
      this,
      [
        callout(page),
        replace,
        page.getByText("AI can make mistakes. Review before using.").first(),
      ],
      16,
    );
  },
};

const summaryCard = {
  name: "ai/summary-card",
  url: (seed) => `${web(seed)}/board`,
  ready: "Annual billing toggle",
  before: async (page, seed) => {
    await aiOn(page);
    const k = (key) => ref(seed, "web", key).key;
    await mock(
      page,
      "POST",
      "/ai/writing/summarize",
      sse(
        {},
        `Website relaunch is moving, but one dependency needs attention this week.\n\n**Status**\n- Four tasks are in progress and two are in review.\n- The Safari autoplay fix (${k("video")}) is in review and due first.\n\n**Risks**\n- ${k("pricing")} blocks ${k("newsletter")}: the newsletter can't start until the pricing page ships.\n- ${k("german")} and ${k("legal")} have no assignee.\n\n**Next**\n- Review the enterprise column copy on ${k("pricing")}.\n- Pick owners for the German landing page and the legal pages.`,
      ),
    );
  },
  async prepare(page) {
    const button = page.getByRole("button", { name: "Summarize project" });
    await button.click();
    await page.getByRole("button", { name: "Try again" }).waitFor();
    await clipAround(this, [cardOf(page, "AI summary", "Try again")], 12);
  },
};

const specDraft = {
  name: "ai/spec-draft",
  url: (seed) => `${web(seed)}/board?taskId=${ref(seed, "web", "a11y").id}`,
  ready: "Draft a spec",
  viewport: { width: 1440, height: 1100 },
  before: async (page) => {
    await aiOn(page);
    await mock(
      page,
      "POST",
      "/ai/writing/spec-draft",
      sse(
        {},
        '## Problem\n\nKeyboard and screen reader users can\'t reliably reach the main navigation: focus jumps between the header and the menu, and there is no skip link.\n\n## Goals\n\n- Every navigation item is reachable with Tab, in visual order.\n- A visible "Skip to content" link on every page.\n- Menus open and close with Enter, Space and Esc.\n\n## Non-goals\n\n- A full audit of every page; this covers the navigation only.\n\n## Approach\n\n1. Audit the header with a screen reader and the keyboard only.\n2. Fix the focus order and add the skip link.\n3. Add automated accessibility checks to CI so it stays fixed.\n\n## Open questions\n\n- Does the mobile menu follow WCAG 2.2 AA too?',
      ),
    );
  },
  async prepare(page) {
    await page.getByRole("button", { name: "Draft a spec" }).click();
    await page.getByRole("button", { name: "Create page" }).waitFor();
    this.clip = { selector: '[role=dialog]:has-text("Create page")', pad: 0 };
  },
};

/* --- Build with AI -------------------------------------------------------- */

function buildProposal() {
  const task = (
    title,
    description,
    priority,
    estimate,
    labels,
    cycleRef,
    moduleRef,
    subtasks = [],
  ) => ({
    title,
    description,
    priority,
    estimate,
    column: null,
    labels,
    cycleRef,
    moduleRef,
    subtasks: subtasks.map((title) => ({ title })),
  });
  return {
    summary:
      "A four-week help center relaunch in two sprints: content first, then search and the launch.",
    project: {
      name: "Help center relaunch",
      key: "HELP",
      description:
        "Rebuild the help center with clearer articles, faster search and help links in the app.",
    },
    columns: [],
    labels: [
      { name: "Content", color: "yellow" },
      { name: "Search", color: "teal" },
    ],
    cycles: [
      {
        ref: "c1",
        name: "Sprint 1: content",
        description: "Audit and rewrite the top articles.",
        startDate: days(5),
        endDate: days(18),
      },
      {
        ref: "c2",
        name: "Sprint 2: search and launch",
        description: "Ship search and go live.",
        startDate: days(19),
        endDate: days(32),
      },
    ],
    modules: [
      {
        ref: "m1",
        name: "Articles",
        description: "Audit, rewrite and redirect.",
      },
      {
        ref: "m2",
        name: "Search",
        description: "Indexing, ranking and reporting.",
      },
    ],
    tasks: [
      task(
        "Audit the 50 most-read articles",
        "List outdated screenshots, broken links and missing steps.",
        "high",
        3,
        ["Content"],
        "c1",
        "m1",
        ["Export page views", "Tag each article keep, rewrite or retire"],
      ),
      task(
        "Rewrite the getting-started guides",
        "One guide per plan, with current screenshots.",
        "high",
        5,
        ["Content"],
        "c1",
        "m1",
      ),
      task(
        "Redirect retired articles",
        "Every retired URL points to its replacement.",
        "medium",
        2,
        ["Content"],
        "c1",
        "m1",
      ),
      task(
        "Index articles for instant search",
        "Search as you type over titles and headings.",
        "high",
        5,
        ["Search"],
        "c2",
        "m2",
        ["Choose the ranking rules"],
      ),
      task(
        "Track searches with no results",
        "A weekly list of what people searched for and didn't find.",
        "medium",
        2,
        ["Search"],
        "c2",
        "m2",
      ),
      task(
        "Add help links to the app",
        '"Learn more" links on the five busiest screens.',
        "medium",
        3,
        [],
        "c2",
        null,
      ),
      task(
        "Announce the new help center",
        "A changelog entry and an email to workspace admins.",
        "low",
        1,
        ["Content"],
        "c2",
        null,
      ),
    ],
  };
}

const BUILD_PROMPT =
  "Plan a four-week help center relaunch in two sprints: rewrite the top articles, add instant search and link help from the app";

async function openBuild(page) {
  await page.keyboard.press("Control+k");
  await page.keyboard.type("Build with AI");
  await page.waitForTimeout(400);
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await dialog.getByText("What should we plan?").waitFor();
  await dialog.getByRole("textbox").first().fill(BUILD_PROMPT);
  await dialog.getByText("A new project", { exact: true }).click();
  return dialog;
}

const buildBefore = async (page) => {
  await aiOn(page);
  await mock(page, "POST", "/ai/build/proposal", {
    proposal: buildProposal(),
    target: null,
    model: "claude-opus-5-5",
  });
};

const buildPrompt = {
  name: "ai/build-prompt",
  url: (seed) => `${web(seed)}/board`,
  ready: "Annual billing toggle",
  before: buildBefore,
  async prepare(page) {
    await openBuild(page);
    this.clip = { selector: "[role=dialog]", pad: 0 };
  },
};

const buildReview = {
  name: "ai/build-review",
  url: (seed) => `${web(seed)}/board`,
  ready: "Annual billing toggle",
  viewport: { width: 1440, height: 1400 },
  before: buildBefore,
  async prepare(page) {
    const dialog = await openBuild(page);
    await dialog.getByRole("button", { name: "Draft plan" }).click();
    await dialog.getByRole("button", { name: /^Create \d+ items$/ }).waitFor();
    this.clip = { selector: "[role=dialog]", pad: 0 };
  },
};

const duplicateCheck = {
  name: "ai/duplicate-check",
  url: (seed) => `${web(seed)}/board`,
  ready: "Annual billing toggle",
  before: async (page, seed) => {
    await aiOn(page);
    const video = ref(seed, "web", "video");
    await mock(page, "POST", "/ai/build/duplicates", {
      tasks: [
        {
          id: video.id,
          key: video.key,
          title: video.title,
          status: "In Review",
          verdict: "duplicate",
          reason:
            "Same Safari autoplay bug on the hero video, worded differently.",
        },
      ],
    });
  },
  async prepare(page) {
    await page.getByRole("button", { name: "Add task" }).first().click();
    await page.getByText("New task").first().waitFor();
    await page.keyboard.type("Hero video does not autoplay in Safari");
    const check = page.getByRole("button", { name: "Check with AI" });
    await check.waitFor();
    await check.click();
    const verdict = page.getByText("Likely duplicate").first();
    await verdict.waitFor();
    await clipAround(
      this,
      [
        page.getByRole("dialog").getByText("New task").first(),
        page.getByText("AI checked these for duplicates").first(),
        verdict,
        page.getByText(/worded differently/).first(),
      ],
      20,
    );
  },
};

/* --- Triage, translation, briefs ---------------------------------------- */

const triageSuggestions = {
  name: "ai/triage-suggestions",
  url: (seed) => `${project(seed, seed.projects.mobile.id)}/intake`,
  ready: "App crashes when opening a push notification",
  before: async (page, seed) => {
    await aiOn(page);
    const rotate = ref(seed, "mobile", "rotate");
    await mock(page, "POST", "/ai/triage/suggest", (route) => ({
      taskId: route.request().postDataJSON()?.taskId ?? "",
      kind: "intake",
      labels: [
        {
          labelId: demo.labels.Bug,
          name: "Bug",
          color: "red",
          reason: `A crash report; similar crashes such as ${rotate.key} carry this label.`,
          applied: false,
        },
        {
          labelId: demo.labels.Backend,
          name: "Backend",
          color: "orange",
          reason: "Push notifications are sent and routed by the backend.",
          applied: false,
        },
      ],
      assignee: {
        userId: demo.users.theo.id,
        name: "Theo Okafor",
        image: null,
        reason: `Theo fixed the last crash in this app, ${rotate.key} ${rotate.title}.`,
      },
      priority: null,
      project: null,
      duplicates: [],
      autoApplied: false,
    }));
  },
  async prepare(page) {
    await page
      .getByText("App crashes when opening a push notification")
      .first()
      .click();
    await page.getByRole("button", { name: "Suggest triage" }).click();
    await page.getByRole("button", { name: "Accept all" }).waitFor();
    await clipAround(
      this,
      [cardOf(page, "Triage suggestions", "Accept all")],
      12,
    );
  },
};

const translateComment = {
  name: "ai/translate-comment",
  url: (seed) => `${web(seed)}/board?taskId=${ref(seed, "web", "german").id}`,
  ready: "Die Übersetzung der Startseite ist fertig",
  before: async (page) => {
    await aiOn(page);
    await mock(page, "POST", "/ai/translate", (route) => {
      const body = route.request().postDataJSON() ?? {};
      return {
        kind: body.kind ?? "comment",
        id: body.id ?? "",
        targetLocale: "en-US",
        status: "translated",
        sourceLanguage: "de",
        text: "The translation of the home page is done. Please check the prices in euros and the text in the contact form before we go live.",
        cached: false,
      };
    });
  },
  async prepare(page) {
    await page
      .getByRole("button", { name: "Translate", exact: true })
      .first()
      .click();
    const original = page
      .getByRole("button", { name: "Show original" })
      .first();
    await original.waitFor();
    const comment = page
      .locator("li, article, div")
      .filter({ has: original })
      .filter({ hasText: "Jonas Weber" })
      .last();
    await clipAround(this, [comment], 12);
  },
};

function briefFacts(seed, end) {
  const t = (key) => {
    const { url, ...task } = ref(seed, "web", key);
    return task;
  };
  return {
    scope: {
      type: "cycle",
      id: sprint14(seed),
      projectId: seed.projects.web.id,
      name: "Sprint 14",
      startDate: addDays(end, -14),
      endDate: end,
    },
    generatedAt: new Date().toISOString(),
    since: ago(7 * 24 * 60),
    truncated: false,
    counts: {
      total: 11,
      backlog: 0,
      unstarted: 3,
      started: 5,
      completed: 3,
      cancelled: 0,
    },
    percent: 27,
    completed: { total: 3, tasks: [t("hero"), t("footer"), t("analytics")] },
    added: { total: 0, tasks: [] },
    removed: { total: 0, tasks: [] },
    inProgress: {
      total: 5,
      tasks: [t("pricing"), t("video"), t("stories"), t("images"), t("social")],
    },
    risks: [
      {
        kind: "blocked_chain",
        severity: "medium",
        total: 1,
        tasks: [t("pricing"), t("newsletter")],
      },
    ],
    forecast: {
      status: "ok",
      remaining: 8,
      p50: addDays(end, -1),
      p85: addDays(end, 2),
      p95: addDays(end, 5),
      probabilityByEnd: 62,
    },
    previous: null,
  };
}

/** Sprint 14's end date (YYYY-MM-DD), read from the API. */
async function sprintEnd(page, seed) {
  const response = await page.request.get(
    `${process.env.PRESS_API_URL}/api/cycle/${sprint14(seed)}`,
  );
  const cycle = await response.json();
  return String(cycle.endDate ?? cycle.cycle?.endDate).slice(0, 10);
}

const stakeholderBrief = {
  name: "ai/stakeholder-brief",
  url: cycleUrl,
  ready: "Sprint 14",
  before: async (page, seed) => {
    await aiOn(page);
    await mock(page, "POST", "/ai/brief", async () => {
      const end = await sprintEnd(page, seed);
      const k = (key) => ref(seed, "web", key).key;
      const citations = Object.keys(TITLES.web).map((key) => {
        const task = ref(seed, "web", key);
        return {
          key: task.key,
          taskId: task.id,
          title: task.title,
          url: task.url,
        };
      });
      return sse(
        { briefId: "brief-sprint-14", facts: briefFacts(seed, end), citations },
        `**Sprint 14 is 27% done with ${daysBetween(days(0), end)} days left and likely to finish two days late.**\n\n**Outcomes**\n- Shipped: the new homepage hero [${k("hero")}], the footer sitemap [${k("footer")}] and cookie-less analytics [${k("analytics")}].\n- In progress: the pricing page [${k("pricing")}] and the customer stories section [${k("stories")}].\n\n**Risks**\n- The pricing page [${k("pricing")}] blocks the newsletter sign-up flow [${k("newsletter")}].\n\n**Dates**\n- 85% likely done by ${shortDay(addDays(end, 2))}; a 62% chance of finishing by the ${shortDay(end)} end date.`,
      );
    });
  },
  async prepare(page) {
    await page
      .getByRole("button", { name: "Write a stakeholder brief" })
      .click();
    await page.getByText("Leadership", { exact: true }).click();
    await page.getByRole("button", { name: "Write brief" }).click();
    await page.getByRole("button", { name: "Save as page" }).waitFor();
    await clipAround(
      this,
      [cardOf(page, "Stakeholder brief", "Save as page")],
      2,
    );
  },
};

/* --- Agents ------------------------------------------------------------- */

function agentFixtures(seed) {
  const now = Date.now();
  const at = (minutes) => new Date(now - minutes * 60_000).toISOString();
  const agents = [
    {
      id: "agent-triage",
      userId: "agent-triage-user",
      name: "Triage Bot",
      description:
        "Splits bug reports into steps, sets a priority and links duplicates.",
      image: null,
      role: "member",
      enabled: true,
      modelTier: "balanced",
      providerOverride: null,
      instructions:
        "Split large tasks into sub-tasks of under a day each. Suggest a priority from the impact described. Comment with a short summary of what you changed.",
      monthlyBudgetMicros: 20_000_000,
      monthSpendMicros: 1_840_000,
      ownerId: seed.user.id,
      createdAt: at(60 * 24 * 9),
      updatedAt: at(60 * 24 * 2),
    },
    {
      id: "agent-notes",
      userId: "agent-notes-user",
      name: "Release Notes",
      description: "Drafts release notes from the tasks done in a cycle.",
      image: null,
      role: "viewer",
      enabled: false,
      modelTier: "fast",
      providerOverride: "local",
      instructions:
        "Write short, customer-facing release notes. Never mention internal task keys.",
      monthlyBudgetMicros: null,
      monthSpendMicros: 0,
      ownerId: seed.user.id,
      createdAt: at(60 * 24 * 6),
      updatedAt: at(60 * 24 * 6),
    },
  ];
  const rotate = ref(seed, "mobile", "rotate");
  const legal = ref(seed, "web", "legal");
  const push = ref(seed, "mobile", "push");
  const agent = {
    id: "agent-triage",
    userId: "agent-triage-user",
    name: "Triage Bot",
  };
  const principal = { id: seed.user.id, name: seed.user.name };
  const taskOf = (task) => ({
    id: task.id,
    projectId: task.projectId,
    key: task.key,
    title: task.title,
  });
  const run = (id, task, extra) => ({
    id,
    agent,
    principal,
    task: taskOf(task),
    trigger: "mention",
    status: "succeeded",
    error: null,
    outputSummary: null,
    tokenIn: 0,
    tokenOut: 0,
    costMicros: 0,
    toolCalls: 0,
    pendingApprovals: 0,
    appliedChanges: 0,
    createdAt: at(30),
    startedAt: at(30),
    finishedAt: at(29),
    ...extra,
  });
  const runs = [
    run("run-legal", legal, {
      trigger: "manual",
      status: "awaiting_approval",
      outputSummary: `The legal page update was dropped from the relaunch, so I proposed moving ${legal.key} to the trash. It waits for your approval.`,
      tokenIn: 9_800,
      tokenOut: 420,
      costMicros: 36_000,
      toolCalls: 2,
      pendingApprovals: 1,
      createdAt: at(4),
      startedAt: at(4),
      finishedAt: null,
    }),
    run("run-rotate", rotate, {
      outputSummary: `Split ${rotate.key} into two sub-tasks, raised the priority to urgent because it blocks the beta build, and summed it up in a comment.`,
      tokenIn: 21_400,
      tokenOut: 1_350,
      costMicros: 84_000,
      toolCalls: 5,
      appliedChanges: 4,
      createdAt: at(38),
      startedAt: at(38),
      finishedAt: at(36),
    }),
    run("run-push", push, {
      trigger: "assign",
      outputSummary: `Read ${push.key} and commented with the three settings it needs: per project, per type and quiet hours.`,
      tokenIn: 7_200,
      tokenOut: 610,
      costMicros: 29_000,
      toolCalls: 3,
      appliedChanges: 1,
      createdAt: at(60 * 5),
      startedAt: at(60 * 5),
      finishedAt: at(60 * 5 - 1),
    }),
  ];
  const step = (seq, kind, extra) => ({
    id: `step-${seq}`,
    seq,
    kind,
    toolName: null,
    risk: null,
    args: null,
    status: "ok",
    reason: null,
    change: null,
    tokenIn: 0,
    tokenOut: 0,
    costMicros: 0,
    appliedAt: null,
    revertedAt: null,
    canUndo: false,
    approval: null,
    createdAt: at(38),
    ...extra,
  });
  const rotateRef = {
    taskId: rotate.id,
    projectId: rotate.projectId,
    taskLabel: `${rotate.key} ${rotate.title}`,
  };
  const applied = (seq, toolName, change) =>
    step(seq, "tool", {
      toolName,
      risk: "write",
      status: "applied",
      change,
      appliedAt: at(37),
      canUndo: true,
    });
  const rotateDetail = {
    ...runs[1],
    steps: [
      step(1, "model", { tokenIn: 6_100, tokenOut: 120, costMicros: 21_000 }),
      step(2, "tool", {
        toolName: "read_task",
        risk: "read",
        args: { taskKey: rotate.key },
      }),
      step(3, "model", { tokenIn: 7_900, tokenOut: 640, costMicros: 33_000 }),
      applied(4, "update_task", {
        op: "update_task",
        ...rotateRef,
        before: { priority: "high" },
        after: { priority: "urgent" },
      }),
      applied(5, "create_subtask", {
        op: "create_subtask",
        ...rotateRef,
        title: "Reproduce on a tablet in landscape",
        description: "",
        status: "to-do",
      }),
      applied(6, "create_subtask", {
        op: "create_subtask",
        ...rotateRef,
        title: "Keep the sheet state across rotation",
        description: "",
        status: "to-do",
      }),
      applied(7, "add_comment", {
        op: "comment",
        ...rotateRef,
        content:
          "Split into two sub-tasks and raised the priority to urgent: this crash blocks the beta build.",
      }),
      step(8, "model", { tokenIn: 7_400, tokenOut: 590, costMicros: 30_000 }),
    ],
  };
  const legalChange = {
    op: "delete_task",
    taskId: legal.id,
    projectId: legal.projectId,
    taskLabel: `${legal.key} ${legal.title}`,
  };
  const expiresAt = new Date(now + 24 * 3_600_000 - 4 * 60_000).toISOString();
  const legalDetail = {
    ...runs[0],
    steps: [
      step(1, "model", {
        tokenIn: 5_200,
        tokenOut: 140,
        costMicros: 19_000,
        createdAt: at(4),
      }),
      step(2, "tool", {
        toolName: "read_task",
        risk: "read",
        args: { taskKey: legal.key },
        createdAt: at(4),
      }),
      step(3, "tool", {
        toolName: "delete_task",
        risk: "destructive",
        status: "pending",
        change: legalChange,
        approval: {
          id: "approval-legal",
          status: "pending",
          expiresAt,
          canDecide: true,
        },
        createdAt: at(4),
      }),
    ],
  };
  const approvals = [
    {
      id: "approval-legal",
      runId: "run-legal",
      stepId: "step-3",
      toolName: "delete_task",
      change: legalChange,
      agent,
      createdAt: at(4),
      expiresAt,
    },
  ];
  return {
    agents,
    runs,
    details: { "run-rotate": rotateDetail, "run-legal": legalDetail },
    approvals,
  };
}

const agentsBefore = async (page, seed) => {
  await aiOn(page);
  const fixtures = agentFixtures(seed);
  await mock(page, "GET", "/ai/agents", fixtures.agents);
  await mock(page, "GET", "/ai/agents/runs", fixtures.runs);
  await mock(page, "GET", /^\/ai\/agents\/runs\/[^/]+$/, (route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop();
    return fixtures.details[id] ?? fixtures.details["run-rotate"];
  });
  await mock(page, "GET", "/ai/agents/approvals", fixtures.approvals);
};

const agentsSettings = {
  name: "ai/agents-settings",
  url: "/dashboard/settings/workspace/agents",
  ready: "Triage Bot",
  before: agentsBefore,
  async prepare(page) {
    await clipAround(
      this,
      [
        page.getByRole("heading", { name: "Agents" }).first(),
        page.getByText(/^Drafts release notes/),
        page.getByRole("button", { name: "New agent" }),
      ],
      20,
    );
  },
};

const newAgent = {
  name: "ai/new-agent",
  url: "/dashboard/settings/workspace/agents",
  ready: "Triage Bot",
  viewport: { width: 1440, height: 1200 },
  before: agentsBefore,
  async prepare(page) {
    await page.getByRole("button", { name: "New agent" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("Sprint Helper");
    await dialog
      .getByLabel("Description")
      .fill("Keeps sprint tasks tidy: due dates, priorities and sub-tasks.");
    await dialog
      .getByLabel("Instructions")
      .fill(
        "When asked, check the task's due date and priority against its cycle, and split work larger than three days into sub-tasks. Explain each change in one comment.",
      );
    await dialog.getByLabel("Monthly budget (USD)").fill("10");
    this.clip = { selector: "[role=dialog]", pad: 0 };
  },
};

const agentDesk = {
  name: "ai/agent-desk",
  url: (seed) => `${ws(seed)}/agents`,
  ready: "Triage Bot",
  viewport: { width: 1440, height: 1000 },
  before: agentsBefore,
  async prepare(page) {
    await page
      .getByRole("button", { name: /Approve/ })
      .first()
      .waitFor();
    this.clip = { x: 312, y: 0, width: 1128, height: 530 };
  },
};

const agentRun = {
  name: "ai/agent-run",
  url: (seed) => `${ws(seed)}/agents`,
  ready: "Triage Bot",
  viewport: { width: 1440, height: 1300 },
  before: agentsBefore,
  async prepare(page, seed) {
    await page
      .getByText(ref(seed, "mobile", "rotate").title)
      .first()
      .click();
    await page
      .getByText("Reproduce on a tablet in landscape")
      .first()
      .waitFor();
    // The run's detail pane, right of the run list.
    const list = await page.getByText("Waiting for you").boundingBox();
    const x = Math.floor(list.x + 408);
    this.clip = { x, y: 92, width: 1440 - x, height: 900 };
  },
};

/* --- Intake capture ------------------------------------------------------ */

const TRANSCRIPT = [
  "Beta sync, Thursday",
  "Theo: two crashes are still open; the push one is the worst. Theo takes the crash reporter before the beta.",
  "Sofia: testers skip most of the onboarding. Sofia will mock up a shorter flow, three screens at most.",
  "Elena: we still need App Store release notes for the beta.",
].join("\n");

const captureBefore = async (page, seed) => {
  await aiOn(page);
  const item = (title, summary, priority, priorityReason, label, owner) => ({
    kind: "action",
    title,
    summary,
    steps: [],
    expected: null,
    actual: null,
    environment: null,
    priority,
    priorityReason,
    labels: [label],
    owner,
  });
  await mock(page, "POST", /^\/ai\/capture\/[^/]+$/, {
    projectId: seed.projects.mobile.id,
    source: "transcript",
    items: [
      item(
        "Add a crash reporter to the beta build",
        "Theo wires up crash reporting before the beta goes out, so crashes like the push notification one arrive with a stack trace.",
        "high",
        "The beta is blocked on two open crashes.",
        { labelId: demo.labels.Bug, name: "Bug", color: "red" },
        {
          userId: demo.users.theo.id,
          name: "Theo Okafor",
          image: null,
          reason: '"Theo takes the crash reporter."',
        },
      ),
      item(
        "Shorten the onboarding to three screens",
        "Testers skipped most of the five onboarding screens. Sofia proposes merging them into three.",
        "medium",
        null,
        { labelId: demo.labels.Design, name: "Design", color: "purple" },
        {
          userId: demo.users.sofia.id,
          name: "Sofia Duarte",
          image: null,
          reason: '"Sofia will mock up a shorter flow."',
        },
      ),
      item(
        "Draft the App Store release notes",
        "Release notes for the beta, covering offline mode and biometric sign-in.",
        "low",
        null,
        { labelId: demo.labels.Docs, name: "Docs", color: "yellow" },
        null,
      ),
    ],
  });
};

async function openCapture(page) {
  await page.getByRole("button", { name: "Capture" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("Transcript", { exact: true }).click();
  await dialog.getByRole("textbox").first().fill(TRANSCRIPT);
  return dialog;
}

const captureInput = {
  name: "ai/capture-transcript",
  url: (seed) => `${project(seed, seed.projects.mobile.id)}/intake`,
  ready: "App crashes when opening a push notification",
  before: captureBefore,
  async prepare(page) {
    await openCapture(page);
    this.clip = { selector: "[role=dialog]", pad: 0 };
  },
};

const captureReview = {
  name: "ai/capture-review",
  url: (seed) => `${project(seed, seed.projects.mobile.id)}/intake`,
  ready: "App crashes when opening a push notification",
  viewport: { width: 1440, height: 1300 },
  before: captureBefore,
  async prepare(page) {
    const dialog = await openCapture(page);
    await dialog.getByRole("button", { name: "Propose requests" }).click();
    await page.getByText("Review proposed requests").waitFor();
    this.clip = { selector: "[role=dialog]", pad: 0 };
  },
};

/* --- Forecast and risk ---------------------------------------------------- */
// The demo projects are only days old, so the computed forecast says "not
// enough history". These shots show the same cards with a filled history.

function filledForecast(body, offsets, probability) {
  const base = body.scope.endDate ?? body.today;
  const point = (offset) => {
    const date = addDays(base, offset);
    return { days: daysBetween(body.today, date) + 1, date };
  };
  return {
    ...body,
    status: "ok",
    reason: null,
    history: {
      from: addDays(body.today, -56),
      to: addDays(body.today, -1),
      days: 56,
      completed: 31,
      activeDays: 24,
      minPerDay: 0,
      maxPerDay: 4,
      perWeek: 3.9,
    },
    p50: point(offsets[0]),
    p85: point(offsets[1]),
    p95: point(offsets[2]),
    probabilityByEnd: body.scope.endDate ? probability : null,
    beyondHorizon: false,
  };
}

function riskTask(seed, projectKey, taskKey, extra = {}) {
  const task = ref(seed, projectKey, taskKey);
  return {
    id: task.id,
    projectId: task.projectId,
    projectSlug: seed.projects[projectKey].slug,
    number: seed.projects[projectKey].tasks[taskKey].number,
    title: task.title,
    status: "in-progress",
    dueDate: null,
    assigneeIds: [],
    ...extra,
  };
}

const SEVERITY = { high: 0, medium: 1, low: 2 };

/** Adds a critical path and ageing work, as a project with history has. */
function filledRisks(seed, body, extraSignal = {}) {
  const id = (key) => ref(seed, "web", key).id;
  const end = body.scope?.endDate ?? null;
  const signals = [
    ...(end
      ? [
          {
            kind: "critical_path",
            severity: "high",
            taskIds: [id("pricing"), id("newsletter")],
            total: 2,
            deadline: end,
            finishDate: addDays(end, 1),
            ...extraSignal,
          },
        ]
      : []),
    ...body.signals.map((signal) => ({ ...signal, ...extraSignal })),
    {
      kind: "ageing",
      severity: "medium",
      taskIds: [id("stories"), id("social")],
      total: 2,
      ageDays: 7,
      thresholdDays: 4,
      ...extraSignal,
    },
  ].sort((a, b) => SEVERITY[a.severity] - SEVERITY[b.severity]);
  const known = new Set(body.tasks.map((task) => task.id));
  const tasks = [
    ...body.tasks,
    ...["stories", "social", "pricing", "newsletter"]
      .filter((key) => !known.has(id(key)))
      .map((key) => riskTask(seed, "web", key)),
  ];
  return {
    ...body,
    ...(body.history
      ? { history: { cycleTime: { samples: 14, p50Days: 2.5, p85Days: 4 } } }
      : {}),
    ...(end
      ? {
          criticalPath: {
            taskIds: [id("pricing"), id("newsletter")],
            hiddenCount: 0,
            total: 6,
            unit: "days",
            finishDate: addDays(end, 1),
            slackDays: -1,
          },
        }
      : {}),
    signals,
    tasks,
  };
}

const deliveryBefore = async (page, seed) => {
  await patchJson(page, /^\/delivery\/cycle\/[^/]+\/forecast$/, (body) =>
    filledForecast(body, [-1, 2, 5], 0.38),
  );
  await patchJson(page, /^\/delivery\/project\/[^/]+\/forecast$/, (body) =>
    filledForecast(body, [26, 33, 40], null),
  );
  await patchJson(page, /^\/delivery\/(cycle|project)\/[^/]+\/risks$/, (body) =>
    filledRisks(seed, body),
  );
};

/** The bordered card around the element showing `text`. */
const cardAround = (page, text) =>
  page
    .getByText(text, { exact: true })
    .first()
    .locator('xpath=ancestor::*[contains(@class,"border")][1]');

const cycleForecast = {
  name: "delivery/cycle-forecast-risks",
  url: cycleUrl,
  ready: "Tasks left",
  before: deliveryBefore,
  async prepare(page) {
    await page
      .getByText(/likely done by/)
      .first()
      .waitFor();
    await clipAround(
      this,
      [cardAround(page, "Forecast"), cardAround(page, "Risks")],
      12,
    );
  },
};

const forecastMethod = {
  name: "delivery/forecast-method",
  url: cycleUrl,
  ready: "Tasks left",
  before: deliveryBefore,
  async prepare(page) {
    await page
      .getByText(/likely done by/)
      .first()
      .waitFor();
    const card = cardAround(page, "Forecast");
    await card.getByRole("button").last().click();
    const popup = page.locator(
      "[data-slot=popover-popup], [role=dialog], [role=tooltip]",
    );
    await popup.first().waitFor();
    await clipAround(this, [card, popup], 12);
  },
  keepPointer: true,
};

const deliveryTab = {
  name: "delivery/delivery-tab",
  url: (seed) => `${web(seed)}/analytics?tab=delivery`,
  ready: "Forecast and risks of this project's open work",
  before: deliveryBefore,
  async prepare(page) {
    await page
      .getByText(/likely done by/)
      .first()
      .waitFor();
    await clipAround(
      this,
      [
        page.getByText("Forecast and risks of this project's open work"),
        cardAround(page, "Forecast"),
        cardAround(page, "Risks"),
      ],
      16,
    );
  },
};

/** Home with the opt-in My brief widget on, first in the list. */
const homeBefore = async (page, seed) => {
  await patchJson(page, "/home/preferences", (body) => {
    const widgets = body.widgets ?? body.preferences?.widgets ?? [];
    const order = ["my-brief", "risks"];
    const next = [
      ...order.map((key) => ({ key, enabled: true })),
      ...widgets.filter((widget) => !order.includes(widget.key)),
    ];
    return body.widgets
      ? { ...body, widgets: next }
      : { ...body, preferences: { ...body.preferences, widgets: next } };
  });
  await patchJson(page, "/delivery/home/risks", (body) => {
    const cycle = body.signals[0] ?? {};
    const where = {
      projectId: cycle.projectId ?? seed.projects.web.id,
      projectName: cycle.projectName ?? "Website relaunch",
      cycleId: cycle.cycleId ?? sprint14(seed),
      cycleName: cycle.cycleName ?? "Sprint 14",
    };
    return filledRisks(seed, body, where);
  });
};

const homeRisks = {
  name: "delivery/home-risks",
  url: (seed) => ws(seed),
  ready: "At risk",
  viewport: TALL,
  before: homeBefore,
  async prepare(page) {
    const widget = page
      .getByText("At risk", { exact: true })
      .locator(
        'xpath=ancestor::*[.//*[contains(normalize-space(),"blocks 1 task")]][1]',
      );
    await clipAround(this, [widget], 12);
  },
};

const myBrief = {
  name: "insight/my-brief",
  url: (seed) => ws(seed),
  ready: "My brief",
  viewport: TALL,
  before: async (page, seed) => {
    await homeBefore(page, seed);
    await aiOn(page);
    const reference = ref(seed, "api", "reference");
    const rotate = ref(seed, "mobile", "rotate");
    await mock(
      page,
      "POST",
      "/ai/insight/my-brief",
      sse(
        {},
        `Start with **${reference.key} ${reference.title}**: it's due today and Jonas mentioned you on it. Then look at **${rotate.key}**: Theo says the rotation crash blocks the beta build.`,
      ),
    );
  },
  async prepare(page) {
    const card = cardAround(page, "My brief");
    await card.getByRole("button", { name: /Summarize/ }).click();
    await page
      .getByText(/blocks the beta build/)
      .first()
      .waitFor();
    await clipAround(this, [card], 12);
  },
};

/* --- Estimates ------------------------------------------------------------ */

const estimateBefore = async (page, seed) => {
  await aiOn(page);
  const calibration = await page.request.get(
    `${process.env.PRESS_API_URL}/api/insight/estimate/project/${seed.projects.web.id}/calibration`,
  );
  const threeId = (await calibration.json()).buckets?.find(
    (bucket) => bucket.value === "3",
  )?.id;
  await patchJson(
    page,
    /^\/insight\/estimate\/project\/[^/]+\/suggestion$/,
    (body) => {
      const similar = (body.similar ?? []).slice(0, 3);
      const pointId = threeId ?? body.suggestion?.pointId;
      const days = [2, 3, 5];
      return {
        ...body,
        status: "ok",
        suggestion: { pointId, value: "3", share: 0.75, matches: 3 },
        cycleTime: { samples: 4, min: 2, median: 3, max: 5 },
        similar: similar.map((task, index) => ({
          ...task,
          value: "3",
          pointId,
          cycleTimeDays: days[index] ?? 3,
          sharedLabels: index === 0 ? ["Frontend"] : [],
        })),
      };
    },
  );
  await mock(
    page,
    "POST",
    "/ai/insight/estimate",
    sse(
      {},
      `Three similar finished tasks in this project were sized at 3 points and took 2 to 5 days, with a median of 3. ${ref(seed, "web", "footer").key} also changed navigation markup, so 3 points fits this audit.`,
    ),
  );
};

const estimateSuggestion = {
  name: "insight/estimate-suggestion",
  url: (seed) => `${web(seed)}/board?taskId=${ref(seed, "web", "a11y").id}`,
  ready: "Draft a spec",
  before: estimateBefore,
  async prepare(page) {
    const button = page.getByRole("button", { name: /^\d+ pts$/ }).first();
    await button.click();
    await page
      .getByText(/Similar tasks were usually/)
      .first()
      .waitFor();
    await page.getByText("Similar tasks", { exact: true }).first().click();
    const popup = page
      .getByText(/Similar tasks were usually/)
      .first()
      .locator(
        'xpath=ancestor::*[@data-slot="popover-popup" or @role="dialog" or @role="listbox"][1]',
      );
    await page.waitForTimeout(300);
    const box = await popup.boundingBox();
    const last = await page
      .getByText(/5 days$/)
      .first()
      .boundingBox();
    const top = await button.boundingBox();
    this.clip = {
      x: Math.floor(Math.min(box.x, top.x) - 12),
      y: Math.floor(top.y - 12),
      width: Math.ceil(
        Math.max(box.x + box.width, top.x + top.width) -
          Math.min(box.x, top.x) +
          24,
      ),
      height: Math.ceil(last.y + last.height - top.y + 24),
    };
  },
  keepPointer: true,
};

const estimateCalibration = {
  name: "insight/estimate-calibration",
  url: (seed) => projectSettings(seed.projects.web.id, "estimates"),
  ready: "Estimate calibration",
  viewport: TALL,
  before: async (page) => {
    const spread = {
      1: [9, 0.5, 1, 1.5, 0.3, 2],
      2: [12, 1, 1.5, 2.5, 0.5, 4],
      3: [15, 2, 3, 4, 1, 6],
      5: [8, 3.5, 5, 7, 2, 11],
      8: [3, 6, 8, 11, 5, 14],
    };
    await patchJson(
      page,
      /^\/insight\/estimate\/project\/[^/]+\/calibration$/,
      (body) => ({
        ...body,
        samples: 47,
        unmeasured: 2,
        ordered: true,
        buckets: body.buckets.map((bucket) => {
          const [samples, p25, median, p75, min, max] = spread[
            bucket.value
          ] ?? [0, null, null, null, null, null];
          return { ...bucket, samples, p25, median, p75, min, max };
        }),
      }),
    );
  },
  async prepare(page) {
    await clipAround(
      this,
      [
        page.getByText("Estimate calibration", { exact: true }),
        page.getByText(/^Bigger estimates took longer/),
      ],
      16,
    );
  },
};

/* --- Cycles: capacity and retrospective ----------------------------------- */

const cycleCapacity = {
  name: "insight/cycle-capacity",
  url: (seed) => `${cycleUrl(seed)}?mode=plan`,
  ready: "Capacity details",
  before: async (page) => {
    await patchJson(page, /^\/insight\/capacity\/cycle\/[^/]+$/, (body) => {
      const typical = {
        "Priya Raman": 8,
        "Jonas Weber": 6,
        "Elena Marsh": 5,
        "Sofia Duarte": 5,
        "Theo Okafor": 6,
      };
      const points = {
        "Priya Raman": 10,
        "Jonas Weber": 8,
        "Elena Marsh": 5,
        "Sofia Duarte": 4,
        "Theo Okafor": 3,
      };
      return {
        ...body,
        basis: "cycles",
        historyCycles: 4,
        unit: "points",
        capacity: { low: 19, typical: 23, high: 27 },
        load: body.committed?.points ?? 30,
        percent: Math.round(((body.committed?.points ?? 30) / 23) * 100),
        status: "over",
        deferrals: (body.deferrals ?? []).map((task, index) => ({
          ...task,
          size: [3, 3, 3][index] ?? task.size,
        })),
        members: (body.members ?? []).map((member) => {
          const pts = points[member.name] ?? member.points;
          const usual = typical[member.name] ?? member.typical;
          return {
            ...member,
            points: pts,
            typical: usual,
            status: pts > usual ? "over" : "ok",
          };
        }),
      };
    });
  },
  async prepare(page) {
    await page.getByText("Capacity details").first().click();
    const panel = page
      .getByText("Capacity details")
      .first()
      .locator(
        "xpath=ancestor::*[.//*[contains(normalize-space(),'tasks planned')]][1]",
      );
    await page.waitForTimeout(400);
    await clipAround(this, [panel], 12);
  },
};

const cycleRetro = {
  name: "insight/cycle-retro",
  url: cycleUrl,
  ready: "Tasks left",
  viewport: { width: 1440, height: 1100 },
  before: async (page, seed) => {
    await aiOn(page);
    const t = (key) => {
      const { url, ...task } = ref(seed, "web", key);
      return task;
    };
    await patchJson(page, /^\/insight\/retro\/cycle\/[^/]+$/, (body) => ({
      ...body,
      counts: {
        committed: 9,
        completed: 3,
        committedCompleted: 3,
        added: 2,
        removed: 0,
        carriedOver: 0,
        leftOpen: 0,
        reopened: 0,
        blocked: 1,
      },
      sayDoPercent: 33,
      points: { committed: 24, completed: 7 },
      added: { total: 2, tasks: [t("social"), t("images")] },
      cycleTime: {
        samples: 3,
        medianDays: 2.5,
        projectP85Days: 4,
        threshold: 4,
        thresholdKind: "project_p85",
        outliers: [],
      },
    }));
    const k = (key) => ref(seed, "web", key).key;
    await mock(
      page,
      "POST",
      "/ai/insight/retro",
      sse(
        {},
        `**Summary**\n\nA third of the committed work is done with a week to go. Two tasks joined after the start (${k("social")}, ${k("images")}), and the newsletter waited on the pricing page all sprint (${k("newsletter")} blocked by ${k("pricing")}).\n\n**Questions to discuss**\n1. Could we have split ${k("pricing")} so the newsletter work could start earlier?\n2. What made us add ${k("social")} mid-sprint, and was it worth it?\n3. Which tasks would we leave out of the next sprint to keep it realistic?`,
      ),
    );
  },
  async prepare(page) {
    await page.getByRole("button", { name: "Prepare a retrospective" }).click();
    await page.getByRole("button", { name: "Write narrative" }).click();
    await page.getByText("Questions to discuss").first().waitFor();
    await clipAround(this, [cardOf(page, "Retrospective", "Save as page")], 2);
  },
};

/* --- Coding agents --------------------------------------------------------- */

const codingProfiles = {
  name: "ai/coding-agent-profiles",
  url: (seed) => projectSettings(seed.projects.web.id, "integrations"),
  ready: "Coding agents",
  viewport: TALL,
  async prepare(page) {
    const header = page.getByText("Coding agents", { exact: true }).first();
    await header.click();
    const add = page.getByRole("button", { name: "Add profile" });
    await add.waitFor();
    // The whole accordion row, so the switches on the right are in.
    const row = header.locator(
      'xpath=ancestor::*[.//button[normalize-space()="Add profile"]][1]',
    );
    await clipAround(this, [row], 8);
  },
};

const insightShots = [
  cycleForecast,
  forecastMethod,
  deliveryTab,
  homeRisks,
  myBrief,
  estimateSuggestion,
  estimateCalibration,
  cycleCapacity,
  cycleRetro,
  codingProfiles,
];

export default [
  automationRules,
  automationEditor,
  automationRuns,
  ruleCompiler,
  a2aToggle,
  workspaceAi,
  workspaceUsage,
  instanceAi,
  askAnswer,
  editorMenu,
  editorPreview,
  summaryCard,
  specDraft,
  buildPrompt,
  buildReview,
  duplicateCheck,
  triageSuggestions,
  translateComment,
  stakeholderBrief,
  agentsSettings,
  newAgent,
  agentDesk,
  agentRun,
  captureInput,
  captureReview,
  ...insightShots,
];
