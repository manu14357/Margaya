/**
 * Screenshots for the Margaya Desktop guide
 * (apps/docs/core/functional/desktop-app.mdx).
 *
 * LOCAL DEVELOPMENT ONLY, and never the installed desktop app. Two kinds of
 * screen:
 *
 * - The app's own windows (server list and settings, quick add, search,
 *   Today, the offline page and its saved copies) come from
 *   the launcher bundle in apps/desktop/dist, so build it first with
 *   `pnpm --filter @margaya/desktop build`. The bundle is served in the
 *   browser at http://tauri.localhost/, the origin Tauri uses on Windows,
 *   and a stand-in for the Rust core (window.__TAURI_INTERNALS__) answers
 *   its commands with the fictional servers below. Nothing is stored and no
 *   server is contacted.
 * - Server windows are the web app with a stand-in desktop bridge
 *   (window.__MARGAYA_DESKTOP__, see apps/web/src/lib/desktop.ts), so it
 *   draws the frameless window's title bar and the desktop-only settings.
 *   Every bridge call does nothing.
 *
 * The browser sign-in page is opened with a made-up request and never
 * confirmed, so no sign-in code is created. Nothing here needs cleaning up.
 *
 * The Download page shot reads the public site (DOCS_SHOTS_SITE_URL, default
 * http://localhost:3001). Until a desktop release exists the page only says
 * "Coming soon", so run the site's `next dev` with DESKTOP_RELEASES_FILE
 * pointing at a saved GitHub Releases API response with fictional files and
 * checksums. Use http://localhost, not 127.0.0.1: next dev refuses its
 * scripts to other origins, and the page then never detects the system.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIST = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../desktop/dist",
);
const LAUNCHER_ORIGIN = "http://tauri.localhost";
const CLIENT = process.env.DOCS_SHOTS_CLIENT_URL ?? "http://localhost:5173";
const SITE = process.env.DOCS_SHOTS_SITE_URL ?? "http://localhost:3001";
/** The app version the stand-ins report; matches the mocked release. */
const APP_VERSION = "1.4.0";

/** The server address the docs show instead of the local dev address. */
const SERVER_HOST = "margaya.studionorth.example";
const SERVER_URL = `https://${SERVER_HOST}`;

const ws = (seed) => `/dashboard/workspace/${seed.workspace.id}`;

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

/** Serves apps/desktop/dist at the Tauri origin. */
async function serveLauncher(page) {
  if (!existsSync(path.join(DIST, "index.html"))) {
    throw new Error(
      "apps/desktop/dist is missing: run `pnpm --filter @margaya/desktop build` first",
    );
  }
  await page.route(`${LAUNCHER_ORIGIN}/**`, (route) => {
    const { pathname } = new URL(route.request().url());
    const file = path.join(DIST, decodeURIComponent(pathname));
    if (!file.startsWith(DIST) || !existsSync(file) || pathname === "/") {
      return route.fulfill({
        status: 200,
        contentType: "text/html",
        body: readFileSync(path.join(DIST, "index.html")),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: TYPES[path.extname(file)] ?? "application/octet-stream",
      body: readFileSync(file),
    });
  });
}

/** A local calendar day relative to today, as quick add and Today use it. */
function day(offset) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return date.toISOString();
}

/**
 * The picture a screenshot to task would attach: a small drawing of a
 * billing page, since the core hands quick add a downscaled preview.
 */
const SCREENSHOT_PREVIEW = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="136" viewBox="0 0 240 136">
    <rect width="240" height="136" fill="#ffffff"/>
    <rect width="240" height="18" fill="#f1f5f2"/>
    <circle cx="10" cy="9" r="3" fill="#cbd5d0"/><circle cx="20" cy="9" r="3" fill="#cbd5d0"/>
    <rect x="12" y="30" width="96" height="9" rx="2" fill="#1f3d2f"/>
    <rect x="12" y="46" width="140" height="6" rx="2" fill="#cbd5d0"/>
    <rect x="12" y="64" width="216" height="58" rx="5" fill="#f6f8f7" stroke="#dfe7e2"/>
    <rect x="22" y="74" width="60" height="6" rx="2" fill="#8aa396"/>
    <rect x="22" y="88" width="120" height="6" rx="2" fill="#cbd5d0"/>
    <rect x="22" y="100" width="96" height="6" rx="2" fill="#cbd5d0"/>
    <rect x="168" y="94" width="50" height="16" rx="4" fill="#2f7a55"/>
  </svg>`,
)}`;

/** Search results for "pricing" on both servers (search_window.rs shape). */
function searchResults(seed) {
  const item = (kind, id, title, key, context, path) => ({
    kind,
    id,
    title,
    key,
    context,
    path,
  });
  return {
    groups: [
      {
        serverId: "studio-north",
        serverLabel: "Studio North",
        workspaceId: seed.workspace.id,
        workspaceName: "Studio North",
        sections: [
          {
            kind: "task",
            items: [
              item(
                "task",
                "t-pricing",
                "Redesign the pricing page",
                "WEB-1",
                "Website relaunch · In progress",
                "/task/1",
              ),
              item(
                "task",
                "t-annual",
                "Annual billing toggle",
                "WEB-14",
                "Website relaunch · To do",
                "/task/2",
              ),
            ],
          },
          {
            kind: "page",
            items: [
              item(
                "page",
                "p-pricing",
                "Pricing experiments",
                null,
                "Website relaunch",
                "/page/1",
              ),
            ],
          },
          {
            kind: "comment",
            items: [
              item(
                "comment",
                "c-pricing",
                "Pricing table copy is approved, ready to build.",
                null,
                "WEB-1 · Priya Raman",
                "/task/1",
              ),
            ],
          },
        ],
      },
      {
        serverId: "personal",
        serverLabel: "Personal",
        workspaceId: "personal-home",
        workspaceName: "Freelance",
        sections: [
          {
            kind: "task",
            items: [
              item(
                "task",
                "t-rates",
                "Update pricing on the portfolio site",
                "FR-7",
                "Portfolio · To do",
                "/task/3",
              ),
            ],
          },
        ],
      },
    ],
    unavailable: [],
  };
}

/** The Today window's tasks (today_window.rs shape). */
function todayTasks(seed) {
  const task = (id, key, title, project, dueOffset) => ({
    serverId: "studio-north",
    serverLabel: "Studio North",
    workspaceId: seed.workspace.id,
    workspaceName: "Studio North",
    id,
    projectId: seed.projects.web.id,
    projectName: project,
    key,
    title,
    dueDate: day(dueOffset),
    overdue: dueOffset < 0,
    priority: "high",
    path: `/task/${id}`,
  });
  return {
    tasks: [
      task("t1", "WEB-1", "Redesign the pricing page", "Website relaunch", -2),
      task("t2", "MOB-4", "Push notification preferences", "Mobile app", -1),
      task(
        "t3",
        "WEB-5",
        "Accessibility audit for the navigation",
        "Website relaunch",
        0,
      ),
      task("t4", "API-3", "Rate limiting per API key", "Platform API", 0),
      task("t5", "WEB-6", "Newsletter sign-up flow", "Website relaunch", 0),
    ],
    unavailable: [],
  };
}

/** Saved copies for offline reading (offline_cache.rs shape). */
function offlineCopies() {
  const now = Date.now();
  const minutes = (count) => now - count * 60_000;
  const summaries = [
    {
      kind: "task",
      id: "copy-pricing",
      title: "Redesign the pricing page",
      workspaceName: "Studio North",
      projectName: "Website relaunch",
      savedAt: minutes(12),
    },
    {
      kind: "page",
      id: "copy-plan",
      title: "Relaunch plan",
      workspaceName: "Studio North",
      projectName: "Website relaunch",
      savedAt: minutes(48),
    },
    {
      kind: "task",
      id: "copy-push",
      title: "Push notification preferences",
      workspaceName: "Studio North",
      projectName: "Mobile app",
      savedAt: minutes(190),
    },
  ];
  const item = {
    ...summaries[0],
    path: "/task/copy-pricing",
    status: "In progress",
    priority: "High",
    dueDate: day(3),
    assignees: ["Elena Marsh", "Priya Raman"],
    bodyText: [
      "The new pricing page shows three plans side by side, with annual billing as the default.",
      "",
      "## Scope",
      "- Plan cards with the new grid",
      "- Annual and monthly toggle",
      "- FAQ under the plans",
      "",
      "## Checklist",
      "- [x] Copy approved by marketing",
      "- [x] Plan comparison table",
      "- [ ] Customer quotes from the stories section",
    ].join("\n"),
    updatedAt: new Date(minutes(30)).toISOString(),
  };
  return { summaries, items: { "task:copy-pricing": item } };
}

/** The fictional state the stand-in Rust core reports. */
function coreState(
  seed,
  { allSignedIn = false, draft = null, offlineItems = false } = {},
) {
  const now = Date.now();
  const copies = offlineCopies();
  return {
    servers: [
      {
        id: "studio-north",
        label: "Studio North",
        webUrl: SERVER_URL,
        apiUrl: SERVER_URL,
        serverVersion: APP_VERSION,
        signedIn: true,
        unread: 3,
        insecure: false,
        lastUsedAt: now,
      },
      {
        id: "personal",
        label: "Personal",
        webUrl: "https://margaya.example.com",
        apiUrl: "https://margaya.example.com",
        serverVersion: APP_VERSION,
        signedIn: allSignedIn,
        unread: 0,
        insecure: false,
        lastUsedAt: now - 86_400_000,
      },
    ],
    settings: {
      version: APP_VERSION,
      platform: "windows",
      autostart: true,
      selfUpdate: true,
      startMinimized: true,
      updateChannel: "stable",
    },
    // The defaults in shortcuts.rs; Today has none until you set one.
    shortcuts: [
      ["quickAdd", "CommandOrControl+Shift+Space"],
      ["search", "CommandOrControl+Shift+K"],
      ["screenshot", "CommandOrControl+Shift+Alt+S"],
      ["today", null],
    ].map(([action, accelerator]) => ({
      action,
      accelerator,
      defaultAccelerator: accelerator,
      active: true,
    })),
    whatsNew: { version: APP_VERSION, pending: false },
    notificationPause: { mode: "off", until: null },
    offlineReading: { enabled: true },
    spellcheck: {
      language: "system",
      languages: ["de-DE", "en-US", "es-ES", "fr-FR", "it-IT", "nl-NL"],
      systemLanguage: "en-US",
      supported: true,
      restartNeeded: false,
    },
    members: [
      { id: "m-elena", name: "Elena Marsh", handle: "elena" },
      { id: "m-priya", name: "Priya Raman", handle: "priya" },
      { id: "m-jonas", name: "Jonas Weber", handle: "jonas" },
      { id: "m-theo", name: "Theo Okafor", handle: "theo" },
      { id: "m-sofia", name: "Sofia Duarte", handle: "sofia" },
    ],
    quickAddPrefs: {
      serverId: "studio-north",
      workspaceId: seed.workspace.id,
      projectId: seed.projects.web.id,
    },
    draft,
    search: searchResults(seed),
    today: todayTasks(seed),
    offlineItems: offlineItems ? copies.summaries : [],
    offlineCopies: copies.items,
    targets: [
      {
        workspaceId: seed.workspace.id,
        workspaceName: "Studio North",
        projects: [
          { id: seed.projects.web.id, name: "Website relaunch" },
          { id: seed.projects.mobile.id, name: "Mobile app" },
          { id: seed.projects.api.id, name: "Platform API" },
        ],
      },
    ],
    offline: {
      serverName: "Studio North",
      webUrl: SERVER_URL,
      errorKind: "unreachable",
      attempt: 3,
      retryInMs: 10_000,
    },
  };
}

/**
 * Stands in for the Tauri runtime: commands answer from `state`; event
 * listeners register and never fire; anything else does nothing.
 */
function installTauriStub(state) {
  let nextId = 1;
  const answers = {
    list_servers: state.servers,
    take_launcher_prompt: null,
    get_settings: state.settings,
    get_shortcuts: state.shortcuts,
    // Recording a shortcut releases them and answers with the same list.
    pause_shortcuts: state.shortcuts,
    whats_new_state: state.whatsNew,
    get_notification_pause: state.notificationPause,
    get_offline_reading: state.offlineReading,
    get_spellcheck: state.spellcheck,
    quick_add_targets: state.targets,
    quick_add_members: state.members,
    quick_add_prefs: state.quickAddPrefs,
    quick_add_draft: state.draft,
    search_query: state.search,
    search_recent: state.search,
    today_tasks: state.today,
    offline_state: state.offline,
    offline_items: state.offlineItems,
  };
  const answer = (cmd, args) => {
    if (cmd === "plugin:event|listen") return nextId++;
    if (cmd === "offline_item") {
      return state.offlineCopies[`${args?.kind}:${args?.id}`] ?? null;
    }
    return answers[cmd] ?? null;
  };
  window.__TAURI_INTERNALS__ = {
    invoke: (cmd, args) =>
      cmd === "offline_retry"
        ? new Promise(() => {})
        : Promise.resolve(answer(cmd, args)),
    transformCallback: () => nextId++,
    unregisterCallback: () => {},
    convertFileSrc: (file) => file,
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { windowLabel: "main", label: "main" },
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
}

/** A Windows desktop bridge whose calls all do nothing. */
function installDesktopBridge(version) {
  const noop = () => {};
  window.__MARGAYA_DESKTOP__ = {
    version,
    platform: "windows",
    startBrowserSignIn: noop,
    openExternal: noop,
    setBadge: noop,
    showQuickAdd: noop,
    takeHandoffSecret: async () => null,
    titleBar: {
      style: "custom",
      platform: "windows",
      leftInset: 0,
      rightInset: 0,
    },
    window: {
      minimize: noop,
      toggleMaximize: noop,
      close: noop,
      startDragging: noop,
      isMaximized: async () => false,
      onStateChange: (listener) => {
        listener({ maximized: false, focused: true, fullscreen: false });
        return noop;
      },
    },
    showServers: noop,
    signedOut: noop,
    openSignInPopup: noop,
    ready: noop,
    notificationSound: "system",
    setSoundMuted: noop,
  };
}

const launcher = (hash = "") => `${LAUNCHER_ORIGIN}/index.html${hash}`;
const launcherSetUp = (options) => async (page, seed) => {
  await serveLauncher(page);
  await page.addInitScript(installTauriStub, coreState(seed, options));
};
// Init scripts run in the page, so the version goes in as an argument.
const desktopSetUp = (page) =>
  page.addInitScript(installDesktopBridge, APP_VERSION);

/** Replaces the local dev address in visible text with the docs' server. */
async function showServerHost(page) {
  const local = new URL(CLIENT).host;
  await page.evaluate(
    ([local, host]) => {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
      );
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.nodeValue?.includes(local)) {
          node.nodeValue = node.nodeValue.replaceAll(local, host);
        }
      }
    },
    [local, SERVER_HOST],
  );
}

const shots = [
  // The app's windows, from the launcher bundle. Sizes are the windows'
  // default sizes in apps/desktop/src-tauri (tauri.conf.json, windows.rs).
  {
    name: "desktop/server-list",
    url: launcher(),
    before: launcherSetUp(),
    ready: "Personal",
    // Much taller than the default window, which scrolls, so the shot shows
    // every Settings row and the keyboard shortcuts.
    viewport: { width: 760, height: 1800 },
    clip: { selector: "#root", pad: 0 },
  },
  {
    name: "desktop/settings-shortcuts",
    url: launcher(),
    before: launcherSetUp(),
    ready: "Keyboard shortcuts",
    prepare: async (page) => {
      // Today has no default, so recording it shows the whole flow.
      await page.getByRole("button", { name: "Change: Today" }).click();
      await page
        .getByRole("button", { name: "Press keys…" })
        .waitFor({ timeout: 10_000 })
        .catch(() => {});
    },
    // Moving the pointer away would blur the recorder and end recording.
    keepPointer: true,
    clip: { selector: "section.shortcut-settings", pad: 12 },
    viewport: { width: 760, height: 1800 },
  },
  {
    name: "desktop/quick-add",
    url: launcher("#quick-add"),
    // Two signed-in servers, so the window also shows its Server field.
    before: launcherSetUp({ allSignedIn: true }),
    ready: "Task title",
    prepare: async (page) => {
      await page
        .getByLabel("Task title")
        .fill("Send the launch checklist to the agency");
      await page.getByRole("button", { name: "Add description" }).click();
      await page
        .getByLabel("Description")
        .fill(
          "The checklist is on the Relaunch plan page. Ask for sign-off by Thursday.",
        );
    },
    clip: { selector: "main.quick-add" },
    viewport: { width: 520, height: 520 },
  },
  {
    name: "desktop/quick-add-parsed",
    url: launcher("#quick-add"),
    // A screenshot to task: the core's draft brings the picture.
    before: launcherSetUp({
      draft: {
        revision: 1,
        title: null,
        description: null,
        attachments: [
          {
            id: "shot-1",
            name: "Screenshot 2026-11-17 104212.png",
            size: 248_000,
            image: true,
            preview: SCREENSHOT_PREVIEW,
          },
        ],
        notices: [],
      },
    }),
    ready: "Task title",
    prepare: async (page) => {
      await page
        .getByLabel("Task title")
        .fill("Send the invoice by friday !high @elena");
      await page.getByRole("button", { name: "Add description" }).click();
      await page
        .getByLabel("Description")
        .fill(
          "November hours are in the screenshot. Use the new billing address.",
        );
    },
    clip: { selector: "main.quick-add" },
    viewport: { width: 520, height: 600 },
  },
  {
    name: "desktop/search",
    url: launcher("#search"),
    // Two signed-in servers, so each group names its server too.
    before: launcherSetUp({ allSignedIn: true }),
    ready: "Recently opened",
    prepare: async (page) => {
      await page.getByRole("combobox").fill("pricing");
      await page.getByText("Update pricing on the portfolio site").waitFor();
    },
    viewport: { width: 640, height: 520 },
  },
  {
    name: "desktop/today",
    url: launcher("#today"),
    before: launcherSetUp(),
    ready: "Due today",
    viewport: { width: 360, height: 480 },
  },
  {
    name: "desktop/offline",
    url: launcher("#offline"),
    before: launcherSetUp({ offlineItems: true }),
    ready: "Recently opened",
    viewport: { width: 760, height: 760 },
  },
  {
    name: "desktop/offline-saved-copy",
    url: launcher("#offline"),
    before: launcherSetUp({ offlineItems: true }),
    ready: "Recently opened",
    prepare: async (page) => {
      await page
        .getByRole("button", { name: /^Redesign the pricing page/ })
        .click();
      await page
        .getByText("Customer quotes from the stories section")
        .waitFor();
    },
    viewport: { width: 760, height: 540 },
  },

  // Server windows: the web app with the desktop bridge.
  {
    name: "desktop/server-window",
    url: (seed) => `${ws(seed)}/project/${seed.projects.web.id}/board`,
    before: desktopSetUp,
    ready: "Annual billing toggle",
    viewport: { width: 1280, height: 820 },
  },
  {
    name: "desktop/notification-sounds",
    url: "/dashboard/settings/account/notifications",
    before: desktopSetUp,
    ready: "In the desktop app",
    prepare: async (page) => {
      await page
        .locator('section:has(h2:text-is("Sounds"))')
        .first()
        .scrollIntoViewIfNeeded();
    },
    clip: { selector: 'section:has(h2:text-is("Sounds"))', pad: 12 },
    viewport: { width: 1440, height: 1400 },
  },

  // The system browser's confirmation page. The request is made up and
  // never confirmed.
  {
    name: "desktop/browser-sign-in",
    url: `/desktop/authorize?${new URLSearchParams({
      state: "docs-shot-desktop-sign-in",
      code_challenge: "D0csSh0tD0csSh0tD0csSh0tD0csSh0tD0csSh0tAAA",
      code_challenge_method: "S256",
    })}`,
    ready: "Sign in to the desktop app",
    prepare: showServerHost,
    clip: {
      selector:
        'xpath=//*[normalize-space()="Sign in to the desktop app"]/ancestor::div[.//button[normalize-space()="Allow"]][1]',
      pad: 32,
    },
  },

  // The public site's Download page: the hero and All downloads, as a
  // Windows visitor sees them. Needs the site running (see the header).
  {
    name: "desktop/download-page",
    url: `${SITE}/download`,
    ready: "All downloads",
    prepare: async (page) => {
      await page.addStyleTag({ content: "nextjs-portal { display: none; }" });
      // The tabs switch to the visitor's system after hydration.
      await page
        .getByRole("tab", { name: /your system/ })
        .first()
        .waitFor({ state: "visible", timeout: 60_000 });
      await page.evaluate(() => {
        const hero = document.querySelector("h1").closest("section");
        const downloads = document.getElementById("downloads");
        const top = hero.getBoundingClientRect().top + 56;
        const bottom = downloads.getBoundingClientRect().bottom + 24;
        const mark = document.createElement("div");
        mark.id = "docs-shot-clip";
        Object.assign(mark.style, {
          position: "fixed",
          left: "0px",
          top: `${top}px`,
          width: "100%",
          height: `${bottom - top}px`,
          pointerEvents: "none",
          zIndex: "-1",
        });
        document.body.append(mark);
      });
    },
    clip: { selector: "#docs-shot-clip" },
    viewport: { width: 1440, height: 1000 },
  },
];

export default shots;
