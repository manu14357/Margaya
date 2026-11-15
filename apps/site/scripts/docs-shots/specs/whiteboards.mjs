/**
 * Screenshots for the whiteboards guides (apps/docs/core/functional/whiteboards/):
 * the lists, the editor and its panels, dialogs and menus, task cards,
 * collaboration, sharing and the phone layout.
 *
 * LOCAL DEVELOPMENT ONLY. ensureWhiteboardDemo() adds boards to Studio
 * North's "Website relaunch" and "Mobile app" projects through the public API
 * the first time and refreshes their content afterwards, so every run starts
 * from the same boards: a planning board with a frame, sticky notes, shapes
 * and two live task cards joined by an arrow, a locked retrospective, a
 * signup flow with bound arrows, a release order whose arrow stands for a
 * real dependency, a homepage review with an uploaded image, pen sketches,
 * an empty board and a set of sticky-note ideas. It turns on public pages for
 * the workspace so the planning board can be published. Some shots open a
 * board as a second Studio North person too, so a collaborator's cursor
 * shows.
 *
 * Shots that change a board (the background pattern, deleting an arrow)
 * only touch boards no other shot depends on, and the next run restores the
 * elements.
 */

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.PRESS_API_URL ??= "http://127.0.0.1:1337";
process.env.PRESS_CLIENT_URL ??= "http://localhost:5173";
const { API_URL, CLIENT_URL, DEMO_USERS, DEMO_WORKSPACE, signIn } =
  await import("../../press/seed-demo.mjs");

const DEMO_PASSWORD = "Margaya-Press-Demo-2026!";
const SITE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const PLANNING = "Launch planning";
const RETRO = "Sprint 14 retrospective";
const FLOW = "Signup flow";
const RELEASE = "Release order";
const REVIEW = "Homepage review";
const SKETCHES = "Hero sketches";
const EMPTY = "Pricing page ideas";
const IDEAS = "Onboarding ideas";

// Sticky-note colours of the editor's palette.
const YELLOW = "#fff3bf";
const ORANGE = "#fed7aa";
const PINK = "#fecdd3";
const GREEN = "#d9f99d";
const BLUE = "#bae6fd";
const PURPLE = "#ddd6fe";

/** The planning board: ids stay fixed so a rerun replaces, never duplicates. */
function planningElements(tasks) {
  return [
    {
      id: "docs-frame",
      type: "frame",
      x: 0,
      y: 0,
      width: 1180,
      height: 600,
      name: "Launch week",
    },
    {
      id: "docs-note-1",
      type: "sticky",
      x: 40,
      y: 60,
      width: 190,
      height: 190,
      text: "Customer quotes on the homepage",
    },
    {
      id: "docs-note-2",
      type: "sticky",
      x: 250,
      y: 60,
      width: 190,
      height: 190,
      text: "Shorter signup form",
      fillColor: GREEN,
    },
    {
      id: "docs-note-3",
      type: "sticky",
      x: 40,
      y: 270,
      width: 190,
      height: 190,
      text: "Dark mode for the docs",
      fillColor: BLUE,
    },
    {
      id: "docs-card-1",
      type: "task",
      x: 520,
      y: 60,
      width: 260,
      height: 120,
      taskId: tasks.pricing.id,
    },
    {
      id: "docs-card-2",
      type: "task",
      x: 520,
      y: 330,
      width: 260,
      height: 120,
      taskId: tasks.video.id,
    },
    {
      id: "docs-arrow",
      type: "arrow",
      x: 650,
      y: 188,
      width: 0,
      height: 134,
      points: [
        [0, 0],
        [0, 134],
      ],
      startBinding: { elementId: "docs-card-1", focus: [0.5, 1], gap: 8 },
      endBinding: { elementId: "docs-card-2", focus: [0.5, 0], gap: 8 },
      endHead: "arrow",
    },
    {
      id: "docs-review",
      type: "rectangle",
      x: 860,
      y: 60,
      width: 260,
      height: 110,
      text: "Launch review\nThursday 10:00",
      cornerRadius: 16,
    },
    {
      id: "docs-goal",
      type: "ellipse",
      x: 880,
      y: 250,
      width: 220,
      height: 130,
      text: "Go live",
      fillColor: YELLOW,
      fillStyle: "solid",
    },
    {
      id: "docs-text",
      type: "text",
      x: 40,
      y: 500,
      width: 520,
      height: 30,
      text: "Pricing blocks the hero video fix: ship it first.",
    },
  ];
}

const retroElements = [
  {
    id: "retro-1",
    type: "frame",
    x: 0,
    y: 0,
    width: 900,
    height: 420,
    name: "Went well",
  },
  {
    id: "retro-2",
    type: "sticky",
    x: 40,
    y: 60,
    width: 180,
    height: 180,
    text: "Fast reviews",
  },
  {
    id: "retro-3",
    type: "sticky",
    x: 240,
    y: 60,
    width: 180,
    height: 180,
    text: "Clear sprint goal",
    fillColor: GREEN,
  },
  {
    id: "retro-4",
    type: "sticky",
    x: 440,
    y: 60,
    width: 180,
    height: 180,
    text: "Fewer meetings",
    fillColor: ORANGE,
  },
];

/** A box's anchor point, as a binding's focus. */
const bind = (elementId, fx, fy) => ({
  elementId,
  focus: [fx, fy],
  gap: 8,
});

const flowElements = [
  {
    id: "flow-1",
    type: "ellipse",
    x: 0,
    y: 0,
    width: 180,
    height: 90,
    text: "Start",
    fillColor: GREEN,
    fillStyle: "solid",
  },
  {
    id: "flow-2",
    type: "rectangle",
    x: 0,
    y: 180,
    width: 180,
    height: 90,
    text: "Enter email",
  },
  {
    id: "flow-3",
    type: "diamond",
    x: -20,
    y: 360,
    width: 220,
    height: 140,
    text: "Valid?",
    fillColor: YELLOW,
    fillStyle: "solid",
  },
  {
    id: "flow-4",
    type: "rectangle",
    x: 300,
    y: 385,
    width: 180,
    height: 90,
    text: "Welcome",
  },
  {
    id: "flow-5",
    type: "rectangle",
    x: -320,
    y: 385,
    width: 180,
    height: 90,
    text: "Show error",
    strokeColor: "#dc2626",
  },
  {
    id: "flow-6",
    type: "shape",
    shape: "document",
    x: 560,
    y: 560,
    width: 200,
    height: 100,
    text: "Welcome email",
  },
  {
    id: "flow-a1",
    type: "arrow",
    x: 90,
    y: 98,
    width: 0,
    height: 74,
    points: [
      [0, 0],
      [0, 74],
    ],
    startBinding: bind("flow-1", 0.5, 1),
    endBinding: bind("flow-2", 0.5, 0),
    endHead: "arrow",
  },
  {
    id: "flow-a2",
    type: "arrow",
    x: 90,
    y: 278,
    width: 0,
    height: 74,
    points: [
      [0, 0],
      [0, 74],
    ],
    startBinding: bind("flow-2", 0.5, 1),
    endBinding: bind("flow-3", 0.5, 0),
    endHead: "arrow",
  },
  {
    id: "flow-yes",
    type: "arrow",
    x: 208,
    y: 430,
    width: 84,
    height: 0,
    points: [
      [0, 0],
      [84, 0],
    ],
    startBinding: bind("flow-3", 1, 0.5),
    endBinding: bind("flow-4", 0, 0.5),
    endHead: "triangle",
    text: "Yes",
  },
  {
    id: "flow-no",
    type: "arrow",
    x: -28,
    y: 430,
    width: 104,
    height: 0,
    points: [
      [0, 0],
      [-104, 0],
    ],
    startBinding: bind("flow-3", 0, 0.5),
    endBinding: bind("flow-5", 1, 0.5),
    endHead: "triangle",
    text: "No",
  },
  {
    id: "flow-retry",
    type: "arrow",
    x: -230,
    y: 377,
    width: 222,
    height: 152,
    routing: "elbow",
    strokeStyle: "dashed",
    points: [
      [0, 0],
      [0, -152],
      [222, -152],
    ],
    startBinding: bind("flow-5", 0.5, 0),
    endBinding: bind("flow-2", 0, 0.5),
    endHead: "arrow",
    text: "Try again",
  },
  {
    id: "flow-mail",
    type: "arrow",
    x: 390,
    y: 483,
    width: 162,
    height: 127,
    routing: "curved",
    points: [
      [0, 0],
      [40, 100],
      [162, 127],
    ],
    startBinding: bind("flow-4", 0.5, 1),
    endBinding: bind("flow-6", 0, 0.5),
    startHead: "dot",
    endHead: "arrow",
  },
];

function releaseElements(tasks) {
  return [
    {
      id: "rel-card-1",
      type: "task",
      x: 0,
      y: 0,
      width: 260,
      height: 120,
      taskId: tasks.cms.id,
    },
    {
      id: "rel-card-2",
      type: "task",
      x: 400,
      y: 0,
      width: 260,
      height: 120,
      taskId: tasks.german.id,
    },
    {
      id: "rel-arrow",
      type: "arrow",
      x: 268,
      y: 60,
      width: 124,
      height: 0,
      points: [
        [0, 0],
        [124, 0],
      ],
      startBinding: bind("rel-card-1", 1, 0.5),
      endBinding: bind("rel-card-2", 0, 0.5),
      endHead: "arrow",
    },
    {
      id: "rel-note",
      type: "sticky",
      x: 720,
      y: -30,
      width: 180,
      height: 180,
      text: "Check the German legal pages before launch",
      fillColor: PINK,
    },
    {
      id: "rel-text",
      type: "text",
      x: 0,
      y: 170,
      width: 640,
      height: 30,
      text: "The blog moves to the new CMS first, then we localize.",
    },
  ];
}

function reviewElements(assetId) {
  return [
    {
      id: "review-frame",
      type: "frame",
      x: 0,
      y: 0,
      width: 1080,
      height: 480,
      name: "Homepage v2",
    },
    {
      id: "review-image",
      type: "image",
      x: 30,
      y: 40,
      width: 660,
      height: 385,
      assetId,
      crop: null,
    },
    {
      id: "review-note-1",
      type: "sticky",
      x: 760,
      y: 40,
      width: 260,
      height: 120,
      text: "Headline is too long on phones",
      fillColor: PINK,
    },
    {
      id: "review-note-2",
      type: "sticky",
      x: 760,
      y: 180,
      width: 260,
      height: 120,
      text: "Use a customer photo in the hero",
      fillColor: YELLOW,
    },
    {
      id: "review-note-3",
      type: "sticky",
      x: 760,
      y: 320,
      width: 260,
      height: 120,
      text: "Keep one call to action",
      fillColor: GREEN,
    },
  ];
}

/** A gentle wave from [0, 0], `length` units wide. */
function wave(length, amplitude, waves) {
  const points = [];
  for (let i = 0; i <= 48; i += 1) {
    const t = i / 48;
    const x = Math.round(t * length);
    const y = Math.round(
      amplitude - amplitude * Math.cos(t * waves * Math.PI * 2),
    );
    points.push([x, y]);
  }
  return points;
}

function stroke(id, x, y, penStyle, extra) {
  const points = wave(420, 22, 2);
  return {
    id,
    type: "draw",
    x,
    y,
    width: 420,
    height: 44,
    points,
    pressures: [],
    simulatePressure: true,
    penStyle,
    ...extra,
  };
}

const sketchElements = [
  {
    id: "sketch-title",
    type: "text",
    x: 0,
    y: -70,
    width: 420,
    height: 36,
    fontSize: 28,
    text: "Hero ideas",
  },
  stroke("sketch-pen", 0, 0, "pen", { strokeColor: "#1e1e1e" }),
  {
    id: "sketch-pen-label",
    type: "text",
    x: 470,
    y: 6,
    width: 300,
    height: 30,
    text: "Pen: quick notes",
  },
  stroke("sketch-marker", 0, 110, "marker", {
    strokeColor: "#2563eb",
    strokeWidth: 4,
  }),
  {
    id: "sketch-marker-label",
    type: "text",
    x: 470,
    y: 116,
    width: 300,
    height: 30,
    text: "Marker: headlines",
  },
  stroke("sketch-highlighter", 0, 220, "highlighter", {
    strokeColor: "#facc15",
    strokeWidth: 4,
  }),
  {
    id: "sketch-highlighter-label",
    type: "text",
    x: 470,
    y: 226,
    width: 320,
    height: 30,
    text: "Highlighter: what matters",
  },
];

const ideaElements = [
  {
    id: "idea-1",
    type: "sticky",
    x: 0,
    y: 0,
    width: 220,
    height: 220,
    text: "Skip button on every intro screen",
  },
  {
    id: "idea-2",
    type: "sticky",
    x: 250,
    y: 0,
    width: 220,
    height: 220,
    text: "Ask for notifications after the first task\nNot on the first launch.",
    fillColor: PURPLE,
  },
  {
    id: "idea-3",
    type: "sticky",
    x: 500,
    y: 0,
    width: 220,
    height: 220,
    text: "Show a sample project\nNew people see how a board works before they add their own.",
    fillColor: BLUE,
  },
];

/** A homepage mock-up, drawn as an SVG and turned into a PNG. */
async function homepageImage() {
  // sharp ships with Next, as in capture.mjs.
  const siteRequire = createRequire(path.join(SITE, "package.json"));
  const sharp = createRequire(siteRequire.resolve("next/package.json"))(
    "sharp",
  );
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700" viewBox="0 0 1200 700">
  <rect width="1200" height="700" fill="#f7f5ef"/>
  <rect width="1200" height="72" fill="#ffffff"/>
  <circle cx="60" cy="36" r="16" fill="#1f6f4a"/>
  <text x="88" y="44" font-family="Segoe UI, Arial, sans-serif" font-size="22" font-weight="700" fill="#1e1e1e">Studio North</text>
  <text x="760" y="43" font-family="Segoe UI, Arial, sans-serif" font-size="17" fill="#444">Work</text>
  <text x="840" y="43" font-family="Segoe UI, Arial, sans-serif" font-size="17" fill="#444">Services</text>
  <text x="950" y="43" font-family="Segoe UI, Arial, sans-serif" font-size="17" fill="#444">Pricing</text>
  <rect x="1040" y="20" width="120" height="34" rx="17" fill="#1f6f4a"/>
  <text x="1100" y="43" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="16" fill="#fff">Contact</text>
  <text x="70" y="230" font-family="Segoe UI, Arial, sans-serif" font-size="56" font-weight="700" fill="#1e1e1e">Websites that launch</text>
  <text x="70" y="298" font-family="Segoe UI, Arial, sans-serif" font-size="56" font-weight="700" fill="#1e1e1e">on time, every time.</text>
  <text x="70" y="360" font-family="Segoe UI, Arial, sans-serif" font-size="22" fill="#555">Design, build and measure with one small team.</text>
  <rect x="70" y="410" width="200" height="56" rx="28" fill="#1f6f4a"/>
  <text x="170" y="445" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="19" fill="#fff">Book a call</text>
  <rect x="290" y="410" width="200" height="56" rx="28" fill="none" stroke="#1f6f4a" stroke-width="2"/>
  <text x="390" y="445" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="19" fill="#1f6f4a">See our work</text>
  <rect x="740" y="130" width="390" height="460" rx="24" fill="#d8e9df"/>
  <circle cx="935" cy="300" r="90" fill="#b7d6c4"/>
  <rect x="820" y="420" width="230" height="20" rx="10" fill="#b7d6c4"/>
  <rect x="860" y="460" width="150" height="20" rx="10" fill="#b7d6c4"/>
  <rect x="70" y="560" width="120" height="14" rx="7" fill="#d9d6cc"/>
  <rect x="210" y="560" width="120" height="14" rx="7" fill="#d9d6cc"/>
  <rect x="350" y="560" width="120" height="14" rx="7" fill="#d9d6cc"/>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Uploads the mock-up to a board once and returns its image id. */
async function ensureReviewImage(session, boardId) {
  const content = await session.get(`/whiteboard/${boardId}/content`);
  const existing = content.elements.find(
    (element) => element.type === "image" && element.assetId,
  );
  if (existing) return existing.assetId;
  const bytes = await homepageImage();
  const created = await session.call("POST", `/whiteboard/${boardId}/assets`, {
    filename: "homepage-v2.png",
    contentType: "image/png",
    size: bytes.length,
  });
  const put = await fetch(new URL(created.upload.uploadUrl, API_URL), {
    method: "PUT",
    headers: {
      ...created.upload.headers,
      Origin: CLIENT_URL,
      Cookie: session.cookieHeader,
    },
    body: bytes,
  });
  if (!put.ok) throw new Error(`Image upload failed: ${put.status}`);
  await session.call(
    "POST",
    `/whiteboard/${boardId}/assets/${created.assetId}/finalize`,
    { contentType: "image/png", size: bytes.length, width: 1200, height: 700 },
  );
  return created.assetId;
}

async function ensureBoard(session, projectId, title, elements) {
  const { whiteboards } = await session.get("/whiteboard", {
    projectId,
    q: title,
  });
  const existing = whiteboards.find((board) => board.title === title);
  if (!existing) {
    return session.call("POST", "/whiteboard", { projectId, title, elements });
  }
  if (existing.isLocked) {
    await session.call("DELETE", `/whiteboard/${existing.id}/lock`);
  }
  if (elements.length > 0) {
    await session.call("POST", `/whiteboard/${existing.id}/elements`, {
      elements,
    });
  }
  return existing;
}

async function projectTasks(session, projectId) {
  const response = await session.get(`/task/tasks/${projectId}`, {
    limit: 100,
    page: 1,
  });
  const board = response.data ?? response;
  return [
    ...board.columns.flatMap((c) => c.tasks),
    ...(board.plannedTasks ?? []),
  ];
}

async function ensureWhiteboardDemo() {
  const press = await signIn(DEMO_USERS.press);
  const workspace = (await press.get("/auth/organization/list")).find(
    (w) => w.name === DEMO_WORKSPACE.name,
  );
  if (!workspace) throw new Error("Run scripts/press/seed-demo.mjs first");
  await press.call("POST", "/auth/organization/set-active", {
    organizationId: workspace.id,
  });
  const projects = await press.get("/project", { workspaceId: workspace.id });
  const web = projects.find((p) => p.slug.toLowerCase() === "web");
  const mobile = projects.find((p) => p.name === "Mobile app");
  if (!web || !mobile) {
    throw new Error("The Studio North projects are missing; reseed first");
  }
  const all = await projectTasks(press, web.id);
  const byTitle = (title) => all.find((task) => task.title === title);
  const tasks = {
    pricing: byTitle("Redesign the pricing page"),
    video: byTitle("Fix hero video autoplay on Safari"),
    cms: byTitle("Migrate the blog to the new CMS"),
    german: byTitle("Localize the landing page for German"),
  };
  if (Object.values(tasks).some((task) => !task)) {
    throw new Error("The Studio North WEB tasks are missing; reseed first");
  }
  // The release board's arrow stands for a real "blocks" relation.
  const relation = await press.request("POST", "/task-relation", {
    sourceTaskId: tasks.cms.id,
    targetTaskId: tasks.german.id,
    relationType: "blocks",
  });
  if (!relation.ok && relation.status !== 409) {
    throw new Error(`Creating the dependency failed: ${relation.status}`);
  }

  await ensureBoard(press, mobile.id, IDEAS, ideaElements);
  // Oldest first, so the planning board is the most recently edited one.
  const empty = await ensureBoard(press, web.id, EMPTY, []);
  const sketches = await ensureBoard(press, web.id, SKETCHES, sketchElements);
  const review = await ensureBoard(press, web.id, REVIEW, []);
  const assetId = await ensureReviewImage(press, review.id);
  await press.call("POST", `/whiteboard/${review.id}/elements`, {
    elements: reviewElements(assetId),
  });
  const release = await ensureBoard(
    press,
    web.id,
    RELEASE,
    releaseElements(tasks),
  );
  const flow = await ensureBoard(press, web.id, FLOW, flowElements);
  const retro = await ensureBoard(press, web.id, RETRO, retroElements);
  const planning = await ensureBoard(
    press,
    web.id,
    PLANNING,
    planningElements(tasks),
  );

  // A locked board and a published one, so the cards show both badges.
  const current = await press.get(`/whiteboard/${retro.id}`);
  if (!current.isLocked) {
    await press.call("POST", `/whiteboard/${retro.id}/lock`);
  }
  await press.call("PATCH", `/workspace/${workspace.id}/settings`, {
    allowPublicPages: true,
  });
  let live = await press.get(`/whiteboard/${planning.id}`);
  // An icon, so the cards, the header and the history show one.
  if (!live.icon) {
    await press.call("PATCH", `/whiteboard/${planning.id}`, { icon: "🚀" });
  }
  if (!live.publicToken) {
    await press.call("POST", `/whiteboard/${planning.id}/publication`);
    live = await press.get(`/whiteboard/${planning.id}`);
  }
  return {
    webId: web.id,
    mobileId: mobile.id,
    publicToken: live.publicToken,
    boards: {
      planning: planning.id,
      retro: retro.id,
      flow: flow.id,
      release: release.id,
      review: review.id,
      sketches: sketches.id,
      empty: empty.id,
    },
    ideasTitle: IDEAS,
  };
}

export const demo = await ensureWhiteboardDemo();

const workspacePath = (seed) => `/dashboard/workspace/${seed.workspace.id}`;
const boardsPath = (seed, projectId = demo.webId) =>
  `${workspacePath(seed)}/project/${projectId}/whiteboards`;
const boardPath = (seed, board, query = "") =>
  `${boardsPath(seed)}/${demo.boards[board]}${query}`;

async function openCanvas(page) {
  const canvas = page.getByRole("application", { name: "Whiteboard canvas" });
  await canvas.waitFor({ state: "visible", timeout: 60_000 });
  // The live board, not the loading skeleton: "Saved" only flashes after a
  // save, so wait for the requests (task cards, images) to settle instead.
  await page
    .waitForLoadState("networkidle", { timeout: 15_000 })
    .catch(() => {});
  await page.waitForTimeout(1_500);
  return canvas;
}

/**
 * Fits the board to the view, optionally zooms out a few steps, then pans
 * it right (Space + drag, exact in screen pixels) so the Style panel at the
 * left doesn't cover it.
 */
async function fitBoard(page, canvas, { zoomOut = 0, pan = 0 } = {}) {
  await canvas.focus();
  await page.keyboard.press("Shift+1");
  await page.waitForTimeout(300);
  for (let step = 0; step < zoomOut; step += 1) {
    await page.keyboard.press("Control+Minus");
    await page.waitForTimeout(150);
  }
  if (pan) {
    const box = await canvas.boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height - 160;
    await page.keyboard.down("Space");
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + pan, y, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up("Space");
  }
  await page.waitForTimeout(300);
}

/**
 * Marks the union of several elements' boxes with an empty fixed element,
 * so a shot can clip to a menu together with the button that opened it.
 */
async function markClip(page, locators, pad = 12) {
  const boxes = [];
  for (const locator of locators) {
    const box = await locator.first().boundingBox();
    if (box) boxes.push(box);
  }
  if (boxes.length === 0) throw new Error("Nothing to clip");
  const left = Math.min(...boxes.map((b) => b.x)) - pad;
  const top = Math.min(...boxes.map((b) => b.y)) - pad;
  const right = Math.max(...boxes.map((b) => b.x + b.width)) + pad;
  const bottom = Math.max(...boxes.map((b) => b.y + b.height)) + pad;
  await page.evaluate(
    ({ left, top, right, bottom }) => {
      const mark = document.createElement("div");
      mark.id = "docs-clip";
      Object.assign(mark.style, {
        position: "fixed",
        left: `${left}px`,
        top: `${top}px`,
        width: `${right - left}px`,
        height: `${bottom - top}px`,
        pointerEvents: "none",
        zIndex: "-1",
      });
      document.body.append(mark);
    },
    { left, top, right, bottom },
  );
}

const MARKED = { selector: "#docs-clip", pad: 0 };

/** Opens a board as another Studio North person, cursor over the notes. */
async function joinAsCollaborator(page, url) {
  const browser = page.context().browser();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  const signedIn = await context.request.post(
    `${API_URL}/api/auth/sign-in/email`,
    {
      data: { email: DEMO_USERS.priya.email, password: DEMO_PASSWORD },
      headers: { Origin: CLIENT_URL },
    },
  );
  if (!signedIn.ok()) {
    throw new Error(`Sign-in as Priya failed: ${signedIn.status()}`);
  }
  const other = await context.newPage();
  await other.goto(new URL(url, CLIENT_URL).href);
  const canvas = await openCanvas(other);
  await canvas.focus();
  await other.keyboard.press("Shift+1");
  const box = await canvas.boundingBox();
  // Left open on purpose: the cursor stays until the runner closes the browser.
  await other.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.42, {
    steps: 8,
  });
  return other;
}

async function waitForCollaborator(page) {
  await page
    .getByRole("button", { name: "Follow Priya Raman" })
    .first()
    .waitFor({ timeout: 30_000 });
  // Let the collaborator's cursor arrive and settle.
  await page.waitForTimeout(1500);
}

/** The board's own toolbar, not the header's. */
const toolbar = (page) => page.getByRole("toolbar", { name: "Tools" });

export default [
  // Overview
  {
    name: "whiteboards/list",
    url: (seed) => boardsPath(seed),
    ready: PLANNING,
    viewport: { width: 1440, height: 760 },
    prepare: async (page) => {
      // Previews are images; wait until each one has loaded.
      await page.waitForFunction(() =>
        [...document.querySelectorAll("main img")].every(
          (img) => img.complete && img.naturalWidth > 0,
        ),
      );
    },
  },
  {
    name: "whiteboards/workspace-list",
    url: (seed) => `${workspacePath(seed)}/whiteboards`,
    ready: IDEAS,
    viewport: { width: 1440, height: 1000 },
    prepare: async (page) => {
      await page.waitForFunction(() =>
        [...document.querySelectorAll("main img")].every(
          (img) => img.complete && img.naturalWidth > 0,
        ),
      );
    },
  },
  {
    name: "whiteboards/editor",
    url: (seed) => boardPath(seed, "planning", "?element=docs-note-2"),
    prepare: async (page, seed) => {
      const canvas = await openCanvas(page);
      await fitBoard(page, canvas, { zoomOut: 2, pan: 110 });
      await joinAsCollaborator(page, boardPath(seed, "planning"));
      await waitForCollaborator(page);
    },
  },
  // Create and organise
  {
    name: "whiteboards/template-menu",
    url: (seed) => boardsPath(seed),
    ready: PLANNING,
    prepare: async (page) => {
      await page
        .getByRole("button", { name: "More ways to create a whiteboard" })
        .click();
      const menu = page.locator('[data-slot="menu-popup"]');
      await menu.waitFor();
      await markClip(page, [
        menu,
        page.getByRole("button", { name: "New whiteboard" }),
      ]);
    },
    clip: MARKED,
  },
  {
    name: "whiteboards/card-menu",
    url: (seed) => boardsPath(seed),
    ready: PLANNING,
    prepare: async (page) => {
      await page
        .getByRole("button", { name: `Actions for ${PLANNING}` })
        .click();
      const menu = page.locator('[data-slot="menu-popup"]');
      await menu.waitFor();
      await markClip(page, [
        menu,
        page.getByRole("link", { name: PLANNING }).first(),
      ]);
    },
    clip: MARKED,
  },
  // Draw and write
  {
    name: "whiteboards/empty-board",
    url: (seed) => boardPath(seed, "empty"),
    viewport: { width: 1440, height: 760 },
    prepare: async (page) => {
      await openCanvas(page);
    },
  },
  {
    name: "whiteboards/toolbar",
    url: (seed) => boardPath(seed, "planning"),
    prepare: async (page) => {
      await openCanvas(page);
    },
    clip: { selector: '[role="toolbar"][aria-label="Tools"]', pad: 8 },
  },
  {
    name: "whiteboards/shape-library",
    url: (seed) => boardPath(seed, "empty"),
    prepare: async (page) => {
      await openCanvas(page);
      await page.getByTestId("whiteboard-shape-picker-trigger").click();
      const picker = page.locator('[data-slot="popover-popup"]');
      await picker.waitFor();
      await markClip(page, [picker, toolbar(page)]);
    },
    clip: MARKED,
  },
  {
    name: "whiteboards/style-panel",
    url: (seed) => boardPath(seed, "flow", "?element=flow-2"),
    viewport: { width: 1440, height: 1300 },
    prepare: async (page) => {
      await openCanvas(page);
    },
    clip: { selector: '[data-testid="whiteboard-properties"]', pad: 0 },
  },
  {
    name: "whiteboards/pen-styles",
    url: (seed) => boardPath(seed, "sketches", "?element=sketch-highlighter"),
    viewport: { width: 1440, height: 820 },
    prepare: async (page) => {
      const canvas = await openCanvas(page);
      await fitBoard(page, canvas, { pan: 110 });
    },
  },
  {
    name: "whiteboards/crop",
    url: (seed) => boardPath(seed, "review", "?element=review-image"),
    viewport: { width: 1440, height: 820 },
    prepare: async (page) => {
      const canvas = await openCanvas(page);
      await fitBoard(page, canvas, { zoomOut: 3, pan: 80 });
      await page.keyboard.press("Enter");
      await page
        .getByRole("button", { name: "Done cropping" })
        .first()
        .waitFor({ timeout: 15_000 });
    },
  },
  {
    name: "whiteboards/context-menu",
    url: (seed) => boardPath(seed, "planning", "?element=docs-review"),
    viewport: { width: 1440, height: 1100 },
    prepare: async (page) => {
      const canvas = await openCanvas(page);
      // `?element=` centres the element in the view: open its menu there.
      const box = await canvas.boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, {
        button: "right",
      });
      const menu = page.getByRole("menu").last();
      await menu.waitFor();
      await markClip(page, [menu], 8);
    },
    clip: MARKED,
  },
  // Arrows and connectors
  {
    name: "whiteboards/arrows",
    url: (seed) => boardPath(seed, "flow", "?element=flow-retry"),
    viewport: { width: 1440, height: 1150 },
    prepare: async (page) => {
      const canvas = await openCanvas(page);
      await fitBoard(page, canvas, { zoomOut: 3, pan: 170 });
    },
  },
  // Canvas and navigation
  {
    name: "whiteboards/background-dots",
    url: (seed) => boardPath(seed, "sketches"),
    viewport: { width: 1440, height: 820 },
    prepare: async (page) => {
      const canvas = await openCanvas(page);
      await fitBoard(page, canvas);
      await page.getByTestId("whiteboard-background-button").click();
      const popover = page.getByTestId("whiteboard-background");
      await popover.waitFor();
      await popover.locator('[data-pattern="dots"]').click();
      await page.waitForTimeout(500);
    },
  },
  {
    name: "whiteboards/background-grid",
    url: (seed) => boardPath(seed, "release"),
    viewport: { width: 1440, height: 820 },
    prepare: async (page) => {
      const canvas = await openCanvas(page);
      await fitBoard(page, canvas);
      await page.getByTestId("whiteboard-background-button").click();
      const popover = page.getByTestId("whiteboard-background");
      await popover.waitFor();
      await popover.locator('[data-pattern="grid"]').click();
      await popover.getByRole("button", { name: "Mint" }).click();
      await page.waitForTimeout(500);
    },
  },
  {
    name: "whiteboards/minimap",
    url: (seed) => boardPath(seed, "flow"),
    viewport: { width: 1440, height: 820 },
    prepare: async (page) => {
      const canvas = await openCanvas(page);
      await fitBoard(page, canvas, { zoomOut: 1 });
      await page.keyboard.press("Alt+M");
      await page.getByRole("img", { name: "Board overview" }).waitFor();
    },
  },
  {
    name: "whiteboards/search",
    url: (seed) => boardPath(seed, "planning"),
    prepare: async (page) => {
      const canvas = await openCanvas(page);
      await canvas.focus();
      await page.keyboard.press("Control+F");
      const dialog = page.getByRole("dialog", { name: "Find on board" });
      await dialog.waitFor();
      await dialog.getByPlaceholder("Search text on this board").fill("launch");
      await page.waitForTimeout(500);
    },
    clip: { selector: "[role=dialog]", pad: 0 },
  },
  // Work with tasks
  {
    name: "whiteboards/task-cards",
    url: (seed) => boardPath(seed, "planning", "?element=docs-arrow"),
    viewport: { width: 1440, height: 1350 },
    prepare: async (page) => {
      const canvas = await openCanvas(page);
      await fitBoard(page, canvas, { zoomOut: 2, pan: 110 });
      await page
        .getByRole("button", { name: "Make dependency" })
        .first()
        .waitFor({ timeout: 15_000 });
    },
  },
  {
    name: "whiteboards/task-picker",
    url: (seed) => boardPath(seed, "planning"),
    prepare: async (page) => {
      await openCanvas(page);
      await page.getByTestId("whiteboard-tool-task").click();
      const dialog = page.getByRole("dialog", { name: "Add task cards" });
      await dialog.waitFor();
      await dialog
        .getByPlaceholder("Search tasks by title or key")
        .fill("pricing");
      await dialog.getByText("Write the pricing FAQ").click();
      await page.waitForTimeout(400);
    },
    clip: { selector: "[role=dialog]", pad: 0 },
  },
  {
    name: "whiteboards/turn-into-tasks",
    url: (seed) => `${boardsPath(seed, demo.mobileId)}`,
    ready: IDEAS,
    prepare: async (page) => {
      await page.getByRole("link", { name: IDEAS }).first().click();
      const canvas = await openCanvas(page);
      await canvas.focus();
      await page.keyboard.press("Control+A");
      await page.getByRole("button", { name: "Turn into 3 tasks" }).click();
      await page
        .getByRole("dialog", { name: "Turn notes into tasks" })
        .waitFor();
      await page.waitForTimeout(400);
    },
    clip: { selector: "[role=dialog]", pad: 0 },
  },
  {
    name: "whiteboards/dependency-prompt",
    url: (seed) => boardPath(seed, "release", "?element=rel-arrow"),
    viewport: { width: 1440, height: 760 },
    prepare: async (page) => {
      const canvas = await openCanvas(page);
      await fitBoard(page, canvas);
      await page
        .getByRole("button", { name: "Remove dependency" })
        .first()
        .waitFor({ timeout: 15_000 });
      await canvas.focus();
      await page.keyboard.press("Delete");
      await page.getByText("Also remove the dependency").waitFor();
    },
  },
  {
    name: "whiteboards/task-on-whiteboards",
    url: (seed) => `${workspacePath(seed)}/task/WEB-1`,
    ready: "On whiteboards",
    viewport: { width: 1440, height: 760 },
  },
  // Collaborate
  {
    name: "whiteboards/follow",
    url: (seed) => boardPath(seed, "flow"),
    viewport: { width: 1440, height: 820 },
    prepare: async (page, seed) => {
      const canvas = await openCanvas(page);
      await fitBoard(page, canvas);
      await joinAsCollaborator(page, boardPath(seed, "flow"));
      await waitForCollaborator(page);
      await page
        .getByRole("button", { name: "Follow Priya Raman" })
        .first()
        .click();
      await page.getByText("Following Priya Raman").waitFor();
      await page.waitForTimeout(800);
    },
  },
  {
    name: "whiteboards/locked-banner",
    url: (seed) => boardPath(seed, "retro"),
    viewport: { width: 1440, height: 640 },
    prepare: async (page) => {
      await openCanvas(page);
    },
  },
  {
    name: "whiteboards/history",
    url: (seed) => boardPath(seed, "planning"),
    // A short viewport keeps the sheet free of empty space.
    viewport: { width: 1440, height: 600 },
    prepare: async (page) => {
      await openCanvas(page);
      await page.getByRole("button", { name: "More board options" }).click();
      await page.getByRole("menuitem", { name: "History" }).click();
      await page.getByText("Board history").first().waitFor();
      await page.waitForTimeout(800);
    },
    clip: { selector: '[data-slot="sheet-popup"]', pad: 0 },
  },
  // Share and export
  {
    name: "whiteboards/share-dialog",
    url: (seed) => boardPath(seed, "planning"),
    prepare: async (page) => {
      await openCanvas(page);
      await page.getByRole("button", { name: "Share", exact: true }).click();
      await page
        .getByRole("dialog", { name: "Share whiteboard" })
        .waitFor({ timeout: 30_000 });
    },
    clip: { selector: "[role=dialog]", pad: 0 },
  },
  {
    name: "whiteboards/export-menu",
    url: (seed) => boardPath(seed, "planning"),
    prepare: async (page) => {
      await openCanvas(page);
      const button = page.getByRole("button", { name: "Export", exact: true });
      await button.click();
      const menu = page.locator('[data-slot="menu-popup"]');
      await menu.waitFor();
      await markClip(page, [menu, button]);
    },
    clip: MARKED,
  },
  {
    name: "whiteboards/more-menu",
    url: (seed) => boardPath(seed, "planning"),
    prepare: async (page) => {
      await openCanvas(page);
      const button = page.getByRole("button", { name: "More board options" });
      await button.click();
      const menu = page.locator('[data-slot="menu-popup"]');
      await menu.waitFor();
      await markClip(page, [menu, button]);
    },
    clip: MARKED,
  },
  {
    name: "whiteboards/public-view",
    url: () => `/public-whiteboard/${demo.publicToken}`,
    ready: PLANNING,
    viewport: { width: 1440, height: 820 },
    prepare: async (page) => {
      await page
        .waitForLoadState("networkidle", { timeout: 15_000 })
        .catch(() => {});
      await page.waitForTimeout(1_500);
    },
  },
  // Keyboard shortcuts
  {
    name: "whiteboards/help-dialog",
    url: (seed) => boardPath(seed, "planning"),
    viewport: { width: 1440, height: 1400 },
    prepare: async (page) => {
      const canvas = await openCanvas(page);
      await canvas.focus();
      await page.keyboard.press("Shift+?");
      const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
      await dialog.waitFor();
      await page.waitForTimeout(800);
      await markClip(page, [dialog], 0);
    },
    clip: MARKED,
  },
  // Phones and tablets
  {
    name: "whiteboards/phone",
    url: (seed) => boardPath(seed, "planning", "?element=docs-card-1"),
    viewport: { width: 390, height: 844 },
    prepare: async (page) => {
      await openCanvas(page);
    },
  },
  {
    name: "whiteboards/phone-more-tools",
    url: (seed) => boardPath(seed, "planning", "?element=docs-card-1"),
    viewport: { width: 390, height: 844 },
    prepare: async (page) => {
      await openCanvas(page);
      await page.getByRole("button", { name: "More tools" }).click();
      await page.locator('[data-slot="menu-popup"]').waitFor();
    },
  },
];
