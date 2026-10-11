#!/usr/bin/env node
/**
 * Seeds the fictional "Studio North" workspace that the press screenshots show.
 *
 * LOCAL DEVELOPMENT ONLY. It talks to a disposable instance (by default the
 * e2e API on :3337 with registration enabled) through the public HTTP API, and
 * the passwords below are public. Every step looks up what exists first, so
 * re-running it reuses the workspace instead of duplicating data.
 *
 *   node scripts/press/seed-demo.mjs
 *   PRESS_API_URL=http://localhost:3337 PRESS_CLIENT_URL=http://localhost:5174 node scripts/press/seed-demo.mjs
 */

import { fileURLToPath } from "node:url";

export const API_URL = process.env.PRESS_API_URL ?? "http://localhost:3337";
export const CLIENT_URL =
  process.env.PRESS_CLIENT_URL ?? "http://localhost:5174";

const PASSWORD = "Margaya-Press-Demo-2026!";

/** Every person is fictional. `press` owns the workspace and takes the shots. */
export const DEMO_USERS = {
  press: { name: "Elena Marsh", email: "press@margaya.test", role: "owner" },
  priya: {
    name: "Priya Raman",
    email: "priya.raman@margaya.test",
    role: "admin",
  },
  jonas: {
    name: "Jonas Weber",
    email: "jonas.weber@margaya.test",
    role: "member",
  },
  theo: {
    name: "Theo Okafor",
    email: "theo.okafor@margaya.test",
    role: "member",
  },
  sofia: {
    name: "Sofia Duarte",
    email: "sofia.duarte@margaya.test",
    role: "member",
  },
};

export const DEMO_WORKSPACE = { name: "Studio North", slug: "studio-north" };

const LABELS = [
  { key: "design", name: "Design", color: "purple" },
  { key: "frontend", name: "Frontend", color: "teal" },
  { key: "backend", name: "Backend", color: "orange" },
  { key: "bug", name: "Bug", color: "red" },
  { key: "docs", name: "Docs", color: "yellow" },
  { key: "research", name: "Research", color: "pink" },
];

/**
 * Tasks: [key, title, status, priority, assignees, labels, start, due, estimate].
 * Start and due are day offsets from today; null leaves the date empty.
 */
const PROJECTS = [
  {
    key: "web",
    name: "Website relaunch",
    slug: "WEB",
    icon: "Globe",
    backlog: true,
    features: {
      cyclesEnabled: true,
      modulesEnabled: true,
      pagesEnabled: true,
      estimatesEnabled: true,
      viewsEnabled: true,
    },
    estimate: {
      name: "Story points",
      type: "points",
      values: ["1", "2", "3", "5", "8"],
    },
    tasks: [
      [
        "pricing",
        "Redesign the pricing page",
        "in-progress",
        "high",
        ["press", "priya"],
        ["design"],
        -4,
        3,
        "5",
      ],
      [
        "video",
        "Fix hero video autoplay on Safari",
        "in-review",
        "urgent",
        ["theo"],
        ["bug", "frontend"],
        -2,
        1,
        "2",
      ],
      [
        "stories",
        "Build the customer stories section",
        "in-progress",
        "medium",
        ["sofia", "press"],
        ["design", "frontend"],
        -2,
        5,
        "3",
      ],
      [
        "images",
        "Lazy-load images below the fold",
        "in-review",
        "medium",
        ["theo"],
        ["frontend"],
        -3,
        2,
        "2",
      ],
      [
        "a11y",
        "Accessibility audit for the navigation",
        "to-do",
        "high",
        ["sofia"],
        ["frontend", "research"],
        2,
        6,
        "3",
      ],
      [
        "newsletter",
        "Newsletter sign-up flow",
        "to-do",
        "medium",
        ["jonas"],
        ["frontend"],
        3,
        10,
        "3",
      ],
      [
        "perf",
        "Add a performance budget to CI",
        "to-do",
        "high",
        ["jonas"],
        ["backend"],
        1,
        8,
        "3",
      ],
      [
        "cms",
        "Migrate the blog to the new CMS",
        "to-do",
        "medium",
        ["jonas"],
        ["backend"],
        4,
        12,
        "8",
      ],
      [
        "hero",
        "Ship the new homepage hero",
        "done",
        "high",
        ["priya"],
        ["design"],
        -12,
        -3,
        "5",
      ],
      [
        "footer",
        "Redesign the footer sitemap",
        "done",
        "low",
        ["priya"],
        ["design"],
        -9,
        -5,
        "1",
      ],
      [
        "analytics",
        "Set up cookie-less analytics",
        "done",
        "low",
        ["jonas"],
        ["backend"],
        -8,
        -4,
        "1",
      ],
      [
        "social",
        "Refresh the social share cards",
        "in-progress",
        "low",
        ["priya"],
        ["design"],
        -1,
        4,
        "2",
      ],
      [
        "german",
        "Localize the landing page for German",
        "backlog",
        "low",
        [],
        ["frontend"],
        null,
        20,
        "5",
      ],
      [
        "legal",
        "Update the legal pages",
        "backlog",
        "no-priority",
        [],
        ["docs"],
        null,
        null,
        null,
      ],
    ],
    subtasks: [
      [
        "pricing",
        "Draft the plan comparison table",
        "done",
        "medium",
        ["priya"],
        [],
        -4,
        -1,
        "2",
      ],
      [
        "pricing",
        "Write the pricing FAQ",
        "in-progress",
        "medium",
        ["press"],
        ["docs"],
        -1,
        2,
        "1",
      ],
      [
        "pricing",
        "Annual billing toggle",
        "to-do",
        "medium",
        ["sofia"],
        ["frontend"],
        1,
        3,
        "2",
      ],
    ],
    blocks: [
      ["pricing", "newsletter"],
      ["cms", "german"],
    ],
    cycles: [
      {
        name: "Sprint 14",
        description: "Pricing, performance and the customer stories launch.",
        start: -7,
        end: 7,
        tasks: [
          "pricing",
          "video",
          "stories",
          "images",
          "a11y",
          "newsletter",
          "perf",
          "hero",
          "footer",
          "analytics",
          "social",
        ],
      },
      {
        name: "Sprint 15",
        description: "Content migration and localisation.",
        start: 8,
        end: 21,
        tasks: ["cms", "german"],
      },
    ],
    modules: [
      {
        name: "Marketing site",
        description: "Public pages, pricing and customer stories.",
        status: "in-progress",
        lead: "priya",
        members: ["priya", "sofia", "press"],
        start: -14,
        target: 10,
        tasks: ["pricing", "stories", "hero", "footer", "social", "newsletter"],
      },
      {
        name: "Content platform",
        description: "The new CMS, localisation and performance work.",
        status: "planned",
        lead: "jonas",
        members: ["jonas", "theo"],
        start: 2,
        target: 28,
        tasks: ["cms", "german", "perf", "images"],
      },
    ],
    comments: [
      [
        "pricing",
        "priya",
        "The comparison table is in review. {press} can you check the enterprise column copy before Thursday?",
      ],
      [
        "pricing",
        "press",
        "Looks great. I tightened the FAQ answers and moved annual billing to the top.",
      ],
      [
        "video",
        "theo",
        "Safari needs `playsinline` and a muted attribute. Fix is up for review, {press}.",
      ],
      [
        "stories",
        "sofia",
        "Three customer quotes are approved. Layout follows the new grid.",
      ],
      [
        "newsletter",
        "jonas",
        "Double opt-in works locally. {press} want the welcome email in this sprint?",
      ],
      ["a11y", "sofia", "Starting with keyboard focus order and skip links."],
    ],
    page: {
      title: "Relaunch plan",
      emoji: "🚀",
      markdown: [
        "The new website goes live at the end of Sprint 15. This page tracks scope, owners and the launch checklist.",
        "",
        "> [!NOTE]",
        "> Scope is frozen for Sprint 14. New requests go to the backlog and are triaged on Mondays.",
        "",
        "## Goals",
        "",
        "- Faster pages: largest contentful paint under 1.8 seconds on mobile",
        "- A pricing page that answers the top ten sales questions",
        "- Customer stories for every plan",
        "",
        "## Launch checklist",
        "",
        "- [x] Ship the new homepage hero",
        "- [x] Cookie-less analytics in place",
        "- [ ] Pricing page signed off",
        "- [ ] Accessibility audit complete",
        "- [ ] Redirects for every old blog URL",
        "",
        "## Owners",
        "",
        "| Area | Owner |",
        "| --- | --- |",
        "| Design | Priya Raman |",
        "| Frontend | Sofia Duarte |",
        "| Platform | Jonas Weber |",
        "",
        "## Open questions",
        "",
        "1. Do we keep the old blog comments?",
        "2. Which locales follow German?",
      ].join("\n"),
    },
  },
  {
    key: "mobile",
    name: "Mobile app",
    slug: "MOB",
    icon: "Smartphone",
    backlog: false,
    features: { cyclesEnabled: true, modulesEnabled: true, pagesEnabled: true },
    tasks: [
      [
        "offline",
        "Offline mode for task lists",
        "in-progress",
        "high",
        ["theo"],
        ["frontend"],
        -5,
        7,
        null,
      ],
      [
        "push",
        "Push notification preferences",
        "to-do",
        "medium",
        ["sofia"],
        ["design"],
        2,
        12,
        null,
      ],
      [
        "rotate",
        "Crash when rotating the task sheet",
        "in-review",
        "urgent",
        ["theo"],
        ["bug"],
        -1,
        0,
        null,
      ],
      [
        "dark",
        "Polish dark mode contrast",
        "done",
        "low",
        ["priya"],
        ["design"],
        -10,
        -2,
        null,
      ],
      [
        "biometric",
        "Biometric sign-in",
        "to-do",
        "medium",
        ["jonas", "press"],
        ["backend"],
        6,
        16,
        null,
      ],
      [
        "store",
        "App Store screenshots",
        "to-do",
        "low",
        ["priya"],
        ["design"],
        9,
        14,
        null,
      ],
    ],
    subtasks: [],
    blocks: [],
    cycles: [],
    modules: [],
    comments: [
      [
        "rotate",
        "theo",
        "Reproduced on two tablets. {press} this one blocks the beta build.",
      ],
    ],
  },
  {
    key: "api",
    name: "Platform API",
    slug: "API",
    icon: "Server",
    backlog: false,
    features: { cyclesEnabled: true, modulesEnabled: true, pagesEnabled: true },
    tasks: [
      [
        "ratelimit",
        "Rate limiting per API key",
        "in-progress",
        "high",
        ["jonas"],
        ["backend"],
        -3,
        4,
        null,
      ],
      [
        "webhooks",
        "Webhook retries with backoff",
        "to-do",
        "medium",
        ["jonas"],
        ["backend"],
        1,
        7,
        null,
      ],
      [
        "reference",
        "Public API v2 reference docs",
        "in-review",
        "medium",
        ["press"],
        ["docs"],
        -6,
        1,
        null,
      ],
      [
        "keys",
        "Rotate signing keys",
        "done",
        "high",
        ["theo"],
        ["backend"],
        -9,
        -6,
        null,
      ],
      [
        "slowquery",
        "Slow query on the activity feed",
        "to-do",
        "urgent",
        ["jonas"],
        ["bug", "backend"],
        0,
        3,
        null,
      ],
      [
        "auditlog",
        "Audit log export",
        "to-do",
        "low",
        ["theo"],
        ["backend"],
        10,
        24,
        null,
      ],
    ],
    subtasks: [],
    blocks: [["ratelimit", "webhooks"]],
    cycles: [],
    modules: [],
    comments: [
      [
        "reference",
        "jonas",
        "Examples for pagination are added. {press} ready for a final read.",
      ],
    ],
  },
];

/** Task descriptions by task key; tasks left out keep an empty description. */
const DESCRIPTIONS = {
  pricing: [
    "Rebuild the pricing page around the three new plans and make annual billing the default.",
    "",
    "## Scope",
    "",
    "- Plan comparison table with the enterprise column",
    "- FAQ covering the top ten sales questions",
    "- Annual and monthly toggle with the saving shown",
  ].join("\n"),
  video:
    "The hero video stays on its poster frame in Safari 17. Autoplay needs `muted` and `playsinline` on the element.",
  stories:
    "A section with three customer quotes, logos and a link to each full story.",
  images:
    "Defer every image below the fold and reserve its space to avoid layout shift.",
  a11y: "Review keyboard order, focus styles and skip links across the main navigation.",
  newsletter: "Double opt-in sign-up in the footer, with a welcome email.",
  perf: "Fail the build when the homepage bundle grows past 180 KB.",
  cms: "Move 140 posts, their images and redirects to the new CMS.",
  offline: "Cache the last opened lists and queue edits while offline.",
  ratelimit: "Limit requests per API key, with clear headers and a 429 body.",
  reference:
    "Reference pages for every v2 endpoint with request and response examples.",
};

const QUICK_LINKS = [
  ["https://brand.studionorth.example", "Brand guidelines"],
  ["https://design.studionorth.example/relaunch", "Relaunch designs"],
  ["https://status.studionorth.example", "Status page"],
];

const STICKIES = [
  [
    "**Friday demo**\n\nPricing page, customer stories and the new hero.",
    "yellow",
  ],
  ["Ask Jonas about the CMS redirect map before Sprint 15 planning.", "teal"],
  [
    "- [x] Review FAQ copy\n- [ ] Sign off pricing\n- [ ] Book launch retro",
    "purple",
  ],
];

// ---------------------------------------------------------------------------

function day(offset, hour = 12) {
  const date = new Date();
  date.setUTCHours(hour, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offset);
  return date;
}

const isoDay = (offset) => day(offset).toISOString().slice(0, 10);

class Session {
  constructor(user) {
    this.user = user;
    this.cookies = new Map();
    this.id = null;
  }

  get cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  async request(method, path, body, query) {
    const url = new URL(`/api${path}`, API_URL);
    for (const [k, v] of Object.entries(query ?? {})) {
      url.searchParams.set(k, String(v));
    }
    const send = () =>
      fetch(url, {
        method,
        headers: {
          Origin: CLIENT_URL,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(this.cookies.size ? { Cookie: this.cookieHeader } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    let response;
    for (let attempt = 1; ; attempt += 1) {
      try {
        response = await send();
        break;
      } catch (error) {
        // A dev API restarts when its sources change; retry everything but
        // creates, which might have landed before the connection dropped.
        if (method === "POST" || attempt === 5) throw error;
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
      }
    }
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const at = pair.indexOf("=");
      this.cookies.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
    }
    const text = await response.text();
    const data = text ? safeJson(text) : null;
    return { ok: response.ok, status: response.status, data, text };
  }

  async call(method, path, body, query) {
    const result = await this.request(method, path, body, query);
    if (!result.ok) {
      throw new Error(
        `${method} ${path} -> ${result.status}: ${result.text.slice(0, 400)}`,
      );
    }
    return result.data;
  }

  get(path, query) {
    return this.call("GET", path, undefined, query);
  }
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function signIn(user) {
  const session = new Session(user);
  const signedIn = await session.request("POST", "/auth/sign-in/email", {
    email: user.email,
    password: PASSWORD,
  });
  if (signedIn.ok) {
    session.id = signedIn.data.user.id;
    return session;
  }
  const signedUp = await session.request("POST", "/auth/sign-up/email", {
    name: user.name,
    email: user.email,
    password: PASSWORD,
  });
  if (!signedUp.ok) {
    throw new Error(
      `sign-up ${user.email} -> ${signedUp.status}: ${signedUp.text}`,
    );
  }
  session.id = signedUp.data.user.id;
  log(`created user ${user.email}`);
  return session;
}

function log(message) {
  console.log(`  ${message}`);
}

async function ensureWorkspace(owner) {
  const list = await owner.get("/auth/organization/list");
  const existing = list.find((w) => w.name === DEMO_WORKSPACE.name);
  if (existing) return existing;
  let slug = DEMO_WORKSPACE.slug;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await owner.request("POST", "/auth/organization/create", {
      name: DEMO_WORKSPACE.name,
      slug,
    });
    if (result.ok) {
      log(`created workspace ${DEMO_WORKSPACE.name}`);
      return result.data;
    }
    if (!/slug/i.test(result.text)) throw new Error(result.text);
    slug = `${DEMO_WORKSPACE.slug}-${Math.random().toString(36).slice(2, 6)}`;
  }
  throw new Error("No free workspace slug");
}

async function ensureMember(owner, invitee, workspaceId) {
  const body = await owner.get("/auth/organization/list-members", {
    organizationId: workspaceId,
    limit: 1000,
  });
  const members = Array.isArray(body) ? body : body.members;
  if (members.some((m) => m.userId === invitee.id)) return;
  const invitations = await owner.get("/auth/organization/list-invitations", {
    organizationId: workspaceId,
  });
  let invitation = invitations.find(
    (i) =>
      i.email.toLowerCase() === invitee.user.email &&
      i.status === "pending" &&
      new Date(i.expiresAt).getTime() > Date.now(),
  );
  invitation ??= await owner.call("POST", "/auth/organization/invite-member", {
    email: invitee.user.email,
    role: invitee.user.role,
    organizationId: workspaceId,
  });
  await invitee.call("POST", "/auth/organization/accept-invitation", {
    invitationId: invitation.id,
  });
  log(`${invitee.user.email} joined`);
}

async function ensureLabels(owner, workspaceId) {
  const existing = await owner.get(`/label/workspace/${workspaceId}`);
  const labels = {};
  for (const spec of LABELS) {
    labels[spec.key] =
      existing.find((l) => l.taskId === null && l.name === spec.name) ??
      (await owner.call("POST", "/label", {
        name: spec.name,
        color: spec.color,
        workspaceId,
      }));
  }
  return labels;
}

async function listTasks(session, projectId) {
  const tasks = [];
  for (let page = 1; ; page += 1) {
    const board = await session.get(`/task/tasks/${projectId}`, {
      limit: 100,
      page,
      sortBy: "createdAt",
      sortOrder: "asc",
    });
    for (const column of board.data.columns) tasks.push(...column.tasks);
    tasks.push(...board.data.plannedTasks, ...board.data.archivedTasks);
    if (page >= board.pagination.totalPages) return tasks;
  }
}

async function ensureProject(sessions, workspaceId, labels, spec) {
  const owner = sessions.press;
  const projects = await owner.get("/project", {
    workspaceId,
    includeArchived: "true",
  });
  let project = projects.find(
    (p) => p.slug.toLowerCase() === spec.slug.toLowerCase(),
  );
  if (!project) {
    project = await owner.call("POST", "/project", {
      name: spec.name,
      workspaceId,
      icon: spec.icon,
      slug: spec.slug,
    });
    log(`created project ${spec.name}`);
  }
  const projectId = project.id;
  await owner.call("PATCH", `/project/${projectId}/features`, spec.features);

  let columns = await owner.get(`/column/${projectId}`);
  if (spec.backlog && !columns.some((c) => c.name === "Backlog")) {
    const created = await owner.call("POST", `/column/${projectId}`, {
      name: "Backlog",
      group: "backlog",
    });
    const ordered = [created, ...columns.filter((c) => c.id !== created.id)];
    await owner.call("PUT", `/column/reorder/${projectId}`, {
      columns: ordered.map((c, position) => ({ id: c.id, position })),
    });
    columns = await owner.get(`/column/${projectId}`);
  }

  let points = {};
  if (spec.estimate) {
    const list = await owner.get(`/estimate/${projectId}`);
    let system = list.estimates.find((e) => e.name === spec.estimate.name);
    system ??= await owner.call(
      "POST",
      `/estimate/${projectId}`,
      spec.estimate,
    );
    if (!system.isActive && list.activeEstimateId === null) {
      await owner.call("POST", `/estimate/${projectId}/${system.id}/activate`, {
        mapping: [],
      });
    }
    points = Object.fromEntries(system.points.map((p) => [p.value, p.id]));
  }

  const existing = await listTasks(owner, projectId);
  const tasks = {};
  const createTask = async (row, parentId) => {
    const [
      key,
      title,
      status,
      priority,
      assignees,
      labelKeys,
      start,
      due,
      estimate,
    ] = row;
    let task = existing.find((t) => t.title === title);
    if (!task) {
      task = await owner.call("POST", `/task/${projectId}`, {
        title,
        description: "",
        priority,
        status,
        assigneeIds: assignees
          // The press user is assigned by a teammate below, so it gets an inbox item.
          .filter((who) => who !== "press")
          .map((who) => sessions[who].id),
        ...(start === null ? {} : { startDate: day(start, 9).toISOString() }),
        ...(due === null ? {} : { dueDate: day(due, 17).toISOString() }),
        ...(estimate && points[estimate]
          ? { estimatePointId: points[estimate] }
          : {}),
      });
      existing.push(task);
    }
    // Each step checks the current state, so an interrupted run resumes cleanly.
    const detail = await owner.get(`/task/${task.id}`);
    const description = parentId ? undefined : DESCRIPTIONS[key];
    if (description && detail.description !== description) {
      await owner.call("PUT", `/task/description/${task.id}`, { description });
    }
    if (
      assignees.includes("press") &&
      !detail.assigneeIds?.includes(sessions.press.id)
    ) {
      // Priya is an admin; the built-in member role cannot assign.
      await sessions.priya.call("PATCH", `/task/assignees/${task.id}`, {
        add: [sessions.press.id],
      });
    }
    const current = await owner.get(`/label/task/${task.id}`);
    for (const labelKey of labelKeys) {
      if (current.some((l) => l.name === labels[labelKey].name)) continue;
      await owner.call("PUT", `/label/${labels[labelKey].id}/task`, {
        taskId: task.id,
      });
    }
    if (parentId) {
      const relations = await owner.get(`/task-relation/${task.id}`);
      if (!JSON.stringify(relations).includes(parentId)) {
        await owner.call("PUT", `/task-relation/parent/${task.id}`, {
          parentTaskId: parentId,
        });
      }
    }
    if (!parentId) tasks[key] = task;
    return task;
  };

  for (const row of spec.tasks) await createTask(row);
  for (const [parentKey, ...rest] of spec.subtasks) {
    await createTask([`${parentKey}-sub`, ...rest], tasks[parentKey].id);
  }

  for (const [source, target] of spec.blocks) {
    const relations = await owner.get(`/task-relation/${tasks[source].id}`);
    const flat = JSON.stringify(relations);
    if (flat.includes(tasks[target].id)) continue;
    await owner.call("POST", "/task-relation", {
      sourceTaskId: tasks[source].id,
      targetTaskId: tasks[target].id,
      relationType: "blocks",
    });
  }

  for (const [key, who, text] of spec.comments) {
    const task = tasks[key];
    const content = text.replace(
      "{press}",
      `<margaya-mention id="${sessions.press.id}" label="${sessions.press.user.name}"></margaya-mention>`,
    );
    const listed = await owner.get(`/comment/${task.id}`);
    const comments = Array.isArray(listed) ? listed : (listed?.comments ?? []);
    const plain = text.split("{press}")[0].slice(0, 24);
    if (comments.some((c) => String(c.content ?? "").includes(plain))) continue;
    await sessions[who].call("POST", `/comment/${task.id}`, { content });
  }

  const cycles = {};
  if (spec.cycles.length) {
    const listed = await owner.get(`/cycle/project/${projectId}`, {
      view: "all",
    });
    for (const c of spec.cycles) {
      let cycle = listed.find((x) => x.name === c.name);
      if (!cycle) {
        cycle = await owner.call("POST", `/cycle/project/${projectId}`, {
          name: c.name,
          description: c.description,
          startDate: isoDay(c.start),
          endDate: isoDay(c.end),
        });
        await owner.call("POST", `/cycle/${cycle.id}/tasks`, {
          taskIds: c.tasks.map((k) => tasks[k].id),
        });
        log(`created cycle ${c.name}`);
      }
      cycles[c.name] = cycle;
    }
  }

  for (const m of spec.modules) {
    const listed = await owner.get(`/module/project/${projectId}`, {
      view: "active",
    });
    if (listed.some((x) => x.name === m.name)) continue;
    const mod = await owner.call("POST", `/module/project/${projectId}`, {
      name: m.name,
      description: m.description,
      status: m.status,
      startDate: isoDay(m.start),
      targetDate: isoDay(m.target),
      leadId: sessions[m.lead].id,
      memberIds: m.members.map((who) => sessions[who].id),
    });
    await owner.call("POST", `/module/${mod.id}/tasks`, {
      taskIds: m.tasks.map((k) => tasks[k].id),
    });
    log(`created module ${m.name}`);
  }

  let page = null;
  if (spec.page) {
    const listed = await owner.get(`/page/project/${projectId}`);
    const pages = Array.isArray(listed) ? listed : (listed?.pages ?? []);
    page = pages.find((p) => p.title === spec.page.title);
    if (!page) {
      page = await owner.call("POST", `/page/project/${projectId}`, {
        title: spec.page.title,
        logoKind: "emoji",
        logoValue: spec.page.emoji,
        content: spec.page.markdown,
      });
      log(`created page ${spec.page.title}`);
    } else {
      // Keeps an existing page in step with the copy above.
      await owner.call("PUT", `/page/${page.id}/content`, {
        markdown: spec.page.markdown,
      });
    }
  }

  return {
    id: projectId,
    name: project.name,
    slug: project.slug,
    tasks: Object.fromEntries(
      Object.entries(tasks).map(([k, t]) => [
        k,
        { id: t.id, number: t.number },
      ]),
    ),
    cycles: Object.fromEntries(
      Object.entries(cycles).map(([k, c]) => [k, { id: c.id }]),
    ),
    page: page ? { id: page.id } : null,
  };
}

const asList = (body, key) =>
  Array.isArray(body) ? body : (body?.[key] ?? []);

/** Quick links and stickies for the press user's Home. */
async function ensureHome(owner, workspaceId) {
  const links = asList(
    await owner.get("/quick-link", { workspaceId }),
    "links",
  );
  for (const [url, title] of QUICK_LINKS) {
    if (links.some((l) => l.title === title)) continue;
    await owner.call("POST", "/quick-link", { workspaceId, url, title });
  }
  const stickies = asList(await owner.get("/sticky", { workspaceId }), "items");
  for (const [content, color] of STICKIES) {
    const copies = stickies.filter((s) => s.content === content);
    // Earlier versions of this script could add the same sticky twice.
    for (const extra of copies.slice(1)) {
      await owner.call("DELETE", `/sticky/${extra.id}`, undefined, {
        workspaceId,
      });
    }
    if (copies.length === 0) {
      await owner.call("POST", "/sticky", { workspaceId, content, color });
    }
  }
}

/** Seeds (or reuses) the demo workspace and returns the ids capture needs. */
export async function seedDemo() {
  console.log(`Seeding ${DEMO_WORKSPACE.name} on ${API_URL}`);
  const sessions = {};
  for (const [key, user] of Object.entries(DEMO_USERS)) {
    sessions[key] = await signIn(user);
  }
  const workspace = await ensureWorkspace(sessions.press);
  for (const key of Object.keys(DEMO_USERS)) {
    if (key !== "press")
      await ensureMember(sessions.press, sessions[key], workspace.id);
  }
  for (const session of Object.values(sessions)) {
    await session.call("POST", "/auth/organization/set-active", {
      organizationId: workspace.id,
    });
  }
  const labels = await ensureLabels(sessions.press, workspace.id);
  const projects = {};
  for (const spec of PROJECTS) {
    projects[spec.key] = await ensureProject(
      sessions,
      workspace.id,
      labels,
      spec,
    );
  }
  await ensureHome(sessions.press, workspace.id);
  return {
    workspace: { id: workspace.id, slug: workspace.slug },
    user: { ...DEMO_USERS.press, id: sessions.press.id, password: PASSWORD },
    projects,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await seedDemo();
  console.log(JSON.stringify(result, null, 2));
}
