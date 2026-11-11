/**
 * Screenshots for the Margaya Desktop guide
 * (apps/docs/core/functional/desktop-app.mdx).
 *
 * LOCAL DEVELOPMENT ONLY, and never the installed desktop app. Two kinds of
 * screen:
 *
 * - The app's own windows (server list, quick add, offline page) come from
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

/** The fictional state the stand-in Rust core reports. */
function coreState(seed, { allSignedIn = false } = {}) {
  const now = Date.now();
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
    },
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
    quick_add_targets: state.targets,
    offline_state: state.offline,
    "plugin:event|listen": 0,
  };
  window.__TAURI_INTERNALS__ = {
    invoke: (cmd) =>
      cmd === "offline_retry"
        ? new Promise(() => {})
        : Promise.resolve(
            cmd === "plugin:event|listen" ? nextId++ : (answers[cmd] ?? null),
          ),
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
    viewport: { width: 760, height: 760 },
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
    },
    clip: { selector: "main.quick-add" },
    viewport: { width: 520, height: 300 },
  },
  {
    name: "desktop/offline",
    url: launcher("#offline"),
    before: launcherSetUp(),
    ready: "Can't reach Studio North",
    // The page fills a whole server window; a shorter one keeps it compact.
    viewport: { width: 760, height: 480 },
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
